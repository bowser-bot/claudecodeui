import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import type { IProviderSessions } from '@/shared/interfaces.js';
import type { AnyRecord, FetchHistoryOptions, FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';
import { createNormalizedMessage, generateMessageId, readObjectRecord, sliceTailPage } from '@/shared/utils.js';

import { hermesFetchJson } from './hermes-client.js';

const PROVIDER = 'hermes';

type HermesMessageRow = {
  id?: number | string;
  role?: string;
  content?: string;
  tool_calls?: unknown;
  tool_call_id?: string | null;
  tool_name?: string | null;
  timestamp?: number | string;
  finish_reason?: string | null;
  reasoning?: string | null;
  reasoning_content?: string | null;
};

function toIsoTimestamp(ts: number | string | undefined): string {
  if (typeof ts === 'number' && Number.isFinite(ts)) {
    return new Date(ts * 1000).toISOString();
  }
  if (typeof ts === 'string' && ts.trim()) {
    return ts;
  }
  return new Date().toISOString();
}

function parseMaybeJson(value: unknown): unknown {
  if (value && typeof value === 'object') {
    return value;
  }
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

/**
 * Maps a Hermes tool name + raw args onto CloudCLI's canonical tool renderers
 * (Bash/Read/Write/Edit/Grep/WebSearch/...) so Hermes tool calls render with the
 * same rich cards as Claude's, instead of a generic blob. Unknown tools keep
 * their name and fall back to generic rendering.
 */
export function mapHermesTool(name: string, rawArgs: unknown): { toolName: string; toolInput: unknown } {
  const args = parseMaybeJson(rawArgs);
  const obj = (args && typeof args === 'object' ? args : {}) as AnyRecord;
  const asString = typeof args === 'string' ? args : '';
  switch (name) {
    case 'execute_code':
      // Hermes execute_code runs Python in a sandbox — render as a Python code
      // block, not a shell command.
      return { toolName: 'ExecuteCode', toolInput: { code: obj.code ?? asString } };
    case 'terminal':
    case 'bash':
    case 'shell':
      return { toolName: 'Bash', toolInput: { command: obj.command ?? obj.cmd ?? asString } };
    case 'read_file':
      return { toolName: 'Read', toolInput: { file_path: obj.file_path ?? obj.path } };
    case 'write_file':
      return { toolName: 'Write', toolInput: { file_path: obj.file_path ?? obj.path, content: obj.content } };
    case 'patch':
    case 'edit_file':
      return { toolName: 'Edit', toolInput: obj };
    case 'search_files':
    case 'grep':
      return { toolName: 'Grep', toolInput: { pattern: obj.query ?? obj.pattern, path: obj.path } };
    case 'web_search':
    case 'x_search':
      return { toolName: 'WebSearch', toolInput: { query: obj.query ?? obj.q } };
    case 'web_fetch':
    case 'fetch_url':
    case 'web_extract':
      return { toolName: 'WebFetch', toolInput: { url: obj.url ?? (Array.isArray(obj.urls) ? obj.urls[0] : undefined) } };
    case 'process':
      return { toolName: 'Bash', toolInput: { command: obj.command ?? obj.cmd ?? asString } };
    default:
      return { toolName: name, toolInput: args };
  }
}

function stripUntrustedWrapper(value: string): string {
  const match = /<untrusted_tool_result[^>]*>([\s\S]*?)<\/untrusted_tool_result>/m.exec(value);
  return match ? match[1].trim() : value;
}

// Tool results can carry a human-readable preamble before the JSON envelope.
function pullJsonBlock(value: string): string | null {
  const i = value.indexOf('{');
  const j = value.lastIndexOf('}');
  return i !== -1 && j > i ? value.slice(i, j + 1) : null;
}

/**
 * Hermes web tools return `{success, data:{web:[{title,url,snippet}]}}`. Render
 * that as a markdown list so the WebSearch/WebFetch cards show clickable results
 * instead of a raw JSON blob. Returns null when the shape isn't web results.
 */
function formatWebResults(inner: string): string | null {
  let obj: AnyRecord;
  try {
    obj = JSON.parse(inner) as AnyRecord;
  } catch {
    return null;
  }
  const data = (obj.data ?? obj) as AnyRecord;
  const arr = (data.web ?? data.results ?? obj.results ?? obj.web) as unknown;
  if (!Array.isArray(arr)) {
    return null;
  }
  if (!arr.length) {
    return '_No results._';
  }
  return arr
    .map((item) => {
      const r = (item ?? {}) as AnyRecord;
      const title = String(r.title ?? r.name ?? r.url ?? 'result');
      const url = String(r.url ?? r.link ?? '');
      const snippet = String(r.snippet ?? r.content ?? r.description ?? '').slice(0, 300);
      return `- [${title}](${url})${snippet ? `\n  ${snippet}` : ''}`;
    })
    .join('\n');
}

/**
 * Hermes tool-role messages wrap their result in a JSON envelope
 * `{status, output, error}`. Pull out clean output text + an error flag.
 */
export function extractHermesToolOutput(content: string | undefined, toolName?: string): { content: string; isError: boolean } {
  if (!content) {
    return { content: '', isError: false };
  }
  const stripped = stripUntrustedWrapper(content);
  const jsonText = pullJsonBlock(stripped);
  // Web tools (web_search / x_search / web_extract) → markdown result list.
  if (toolName && /search|extract/.test(toolName) && jsonText) {
    const formatted = formatWebResults(jsonText);
    if (formatted !== null) {
      return { content: formatted, isError: false };
    }
  }
  const parsed = jsonText ? parseMaybeJson(jsonText) : null;
  if (parsed && typeof parsed === 'object') {
    const rec = parsed as AnyRecord;
    const isError = rec.status === 'error' || Boolean(rec.error);
    const out = typeof rec.output === 'string' ? rec.output : '';
    const err = typeof rec.error === 'string' ? rec.error : '';
    return { content: out || err || stripped, isError };
  }
  return { content: stripped, isError: false };
}

/**
 * Normalizes one persisted Hermes message row (from GET /api/sessions/:id/messages).
 */
function normalizeHistoryRow(row: HermesMessageRow): NormalizedMessage[] {
  const ts = toIsoTimestamp(row.timestamp);
  const baseId = row.id != null ? `hermes_${row.id}` : generateMessageId('hermes');
  const out: NormalizedMessage[] = [];

  const reasoning = row.reasoning || row.reasoning_content;
  if (reasoning && reasoning.trim() && row.role === 'assistant') {
    out.push(createNormalizedMessage({
      id: `${baseId}_think`, sessionId: null, timestamp: ts, provider: PROVIDER,
      kind: 'thinking', content: reasoning,
    }));
  }

  if (row.role === 'tool') {
    const { content, isError } = extractHermesToolOutput(row.content, row.tool_name || undefined);
    out.push(createNormalizedMessage({
      id: baseId, sessionId: null, timestamp: ts, provider: PROVIDER,
      kind: 'tool_result', toolId: row.tool_call_id || '', content, isError,
    }));
    return out;
  }

  // Assistant tool calls (OpenAI-style tool_calls array) → one tool_use each,
  // mapped onto canonical CloudCLI tool renderers.
  if (Array.isArray(row.tool_calls) && row.tool_calls.length) {
    for (const call of row.tool_calls as AnyRecord[]) {
      const fn = readObjectRecord(call?.function) ?? {};
      const mapped = mapHermesTool(
        (fn.name as string) || (call?.type as string) || 'tool',
        fn.arguments ?? call?.arguments,
      );
      out.push(createNormalizedMessage({
        id: `${baseId}_${call?.id || generateMessageId('tc')}`, sessionId: null, timestamp: ts, provider: PROVIDER,
        kind: 'tool_use',
        toolName: mapped.toolName,
        toolInput: mapped.toolInput,
        toolId: (call?.id as string) || baseId,
      }));
    }
  }

  if ((row.role === 'user' || row.role === 'assistant') && typeof row.content === 'string' && row.content.trim()) {
    out.push(createNormalizedMessage({
      id: baseId, sessionId: null, timestamp: ts, provider: PROVIDER,
      kind: 'text', role: row.role, content: row.content,
    }));
  }

  return out;
}

export class HermesSessionsProvider implements IProviderSessions {
  /**
   * Normalizes either a persisted Hermes message row or a live intermediate
   * event produced by hermes-gateway.js. Live events carry a `type` discriminator;
   * history rows carry a `role`.
   */
  normalizeMessage(rawMessage: unknown, sessionId: string | null): NormalizedMessage[] {
    const raw = readObjectRecord(rawMessage);
    if (!raw) {
      return [];
    }

    // History row from the gateway messages API.
    if (typeof raw.role === 'string' && raw.type === undefined) {
      return normalizeHistoryRow(raw as HermesMessageRow).map((msg) => ({ ...msg, sessionId: sessionId ?? msg.sessionId }));
    }

    const ts = new Date().toISOString();
    const baseId = generateMessageId('hermes');

    switch (raw.type) {
      case 'assistant_text':
        return [createNormalizedMessage({ id: baseId, sessionId, timestamp: ts, provider: PROVIDER, kind: 'text', role: 'assistant', content: String(raw.content || '') })];
      case 'thinking':
        return [createNormalizedMessage({ id: baseId, sessionId, timestamp: ts, provider: PROVIDER, kind: 'thinking', content: String(raw.content || '') })];
      case 'tool_use': {
        const mapped = mapHermesTool(String(raw.toolName || 'tool'), raw.toolInput);
        return [createNormalizedMessage({ id: baseId, sessionId, timestamp: ts, provider: PROVIDER, kind: 'tool_use', toolName: mapped.toolName, toolInput: mapped.toolInput, toolId: String(raw.toolId || baseId) })];
      }
      case 'tool_result':
        return [createNormalizedMessage({ id: baseId, sessionId, timestamp: ts, provider: PROVIDER, kind: 'tool_result', toolId: String(raw.toolId || ''), content: String(raw.content || ''), isError: Boolean(raw.isError) })];
      case 'error':
        return [createNormalizedMessage({ id: baseId, sessionId, timestamp: ts, provider: PROVIDER, kind: 'error', content: String(raw.content || 'Unknown error') })];
      default:
        return [];
    }
  }

  /**
   * Loads message history from the gateway and pairs tool results with calls.
   */
  async fetchHistory(sessionId: string, options: FetchHistoryOptions = {}): Promise<FetchHistoryResult> {
    const { limit = null, offset = 0 } = options;

    let rows: HermesMessageRow[] = [];
    try {
      const data = await hermesFetchJson<{ data?: HermesMessageRow[] }>(`/api/sessions/${encodeURIComponent(sessionId)}/messages`);
      rows = Array.isArray(data.data) ? data.data : [];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[HermesProvider] Failed to load session ${sessionId}:`, message);
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }

    const normalized: NormalizedMessage[] = [];
    for (const row of rows) {
      normalized.push(...normalizeHistoryRow(row).map((msg) => ({ ...msg, sessionId })));
    }

    // Attach tool results to their originating tool_use entries.
    const toolResultMap = new Map<string, NormalizedMessage>();
    for (const msg of normalized) {
      if (msg.kind === 'tool_result' && msg.toolId) {
        toolResultMap.set(msg.toolId, msg);
      }
    }
    for (const msg of normalized) {
      if (msg.kind === 'tool_use' && msg.toolId && toolResultMap.has(msg.toolId)) {
        const toolResult = toolResultMap.get(msg.toolId);
        if (toolResult) {
          msg.toolResult = { content: toolResult.content, isError: toolResult.isError };
        }
      }
    }

    let total = 0;
    for (const msg of normalized) {
      if (msg.kind !== 'tool_result') {
        total += 1;
      }
    }
    const normalizedOffset = Math.max(0, offset);
    const normalizedLimit = limit === null ? null : Math.max(0, limit);
    const { page, hasMore } = sliceTailPage(normalized, normalizedLimit, normalizedOffset);

    return { messages: page, total, hasMore, offset: normalizedOffset, limit: normalizedLimit };
  }
}

/**
 * Hermes Gateway Integration
 * ==========================
 *
 * Streams chat turns from a remote Hermes Agent "api_server" gateway and
 * forwards them to CloudCLI's websocket as normalized messages. Unlike the
 * SDK/CLI providers, Hermes runs server-side behind an OpenAI-compatible HTTP
 * gateway, so this runner is a thin SSE client rather than a child process.
 *
 *   queryHermes(command, options, ws) - send a prompt, stream the reply
 *   abortHermesSession(sessionId)     - interrupt an active run
 *
 * Transport: POST /api/sessions/{id}/chat/stream returns Server-Sent Events:
 *   run.started → message.started → assistant.delta* → tool.progress* →
 *   (tool.started/tool.completed/tool.failed)* → assistant.completed →
 *   run.completed → done
 */

import { notifyRunFailed, notifyRunStopped } from './services/notification-orchestrator.js';
import { sessionsService } from './modules/providers/services/sessions.service.js';
import { providerModelsService } from './modules/providers/services/provider-models.service.js';
import { createCompleteMessage, createNormalizedMessage } from './shared/utils.js';

const DEFAULT_BASE_URL = 'http://127.0.0.1:8642';

// sessionId -> { abortController, status, startedAt }
const activeHermesSessions = new Map();

function gatewayConfig() {
  const baseUrl = (process.env.HERMES_GATEWAY_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const apiKey = process.env.HERMES_API_KEY || process.env.API_SERVER_KEY || '';
  return { baseUrl, apiKey };
}

function authHeaders(apiKey, extra = {}) {
  return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...extra };
}

/**
 * The CloudCLI model picker encodes each Hermes option as `provider:model` so
 * the gateway can resolve the right provider's credentials. Split on the FIRST
 * colon only (Ollama model ids like `deepseek-v3.1:671b` contain colons). A
 * value with no provider prefix (e.g. the `hermes-agent` fallback) yields no
 * provider, letting the gateway use its configured default.
 */
function parseModelValue(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return { model: undefined, provider: undefined };
  }
  const s = value.trim();
  const idx = s.indexOf(':');
  if (idx === -1) {
    return { model: s, provider: undefined };
  }
  return { provider: s.slice(0, idx), model: s.slice(idx + 1) };
}

/**
 * Hermes tool-role messages wrap their result in a JSON envelope
 * `{status, output, error}`. Extract clean output text + an error flag.
 */
function stripUntrustedWrapper(s) {
  const m = /<untrusted_tool_result[^>]*>([\s\S]*?)<\/untrusted_tool_result>/m.exec(s);
  return m ? m[1].trim() : s;
}

// Tool results can carry a human-readable preamble before the JSON envelope.
// Pull out just the top-level JSON object so it can be parsed.
function pullJsonBlock(s) {
  const i = s.indexOf('{');
  const j = s.lastIndexOf('}');
  return i !== -1 && j > i ? s.slice(i, j + 1) : null;
}

// Hermes web tools return {success, data:{web:[{title,url,snippet}]}}; render
// that as a markdown list. Returns null when the shape isn't web results.
function formatWebResults(inner) {
  let obj;
  try { obj = JSON.parse(inner); } catch { return null; }
  const data = (obj && obj.data) || obj || {};
  const arr = data.web || data.results || obj.results || obj.web;
  if (!Array.isArray(arr)) {
    return null;
  }
  if (!arr.length) {
    return '_No results._';
  }
  return arr.map((item) => {
    const r = item || {};
    const title = String(r.title || r.name || r.url || 'result');
    const url = String(r.url || r.link || '');
    const snippet = String(r.snippet || r.content || r.description || '').slice(0, 300);
    return `- [${title}](${url})${snippet ? `\n  ${snippet}` : ''}`;
  }).join('\n');
}

function extractToolOutput(content, toolName) {
  if (!content) {
    return { content: '', isError: false };
  }
  const raw = typeof content === 'string' ? content : JSON.stringify(content);
  const stripped = stripUntrustedWrapper(raw);
  const jsonText = pullJsonBlock(stripped);
  if (toolName && /search|extract/.test(toolName) && jsonText) {
    const formatted = formatWebResults(jsonText);
    if (formatted !== null) {
      return { content: formatted, isError: false };
    }
  }
  let parsed = null;
  if (jsonText) { try { parsed = JSON.parse(jsonText); } catch { parsed = null; } }
  if (parsed && typeof parsed === 'object') {
    const isError = parsed.status === 'error' || Boolean(parsed.error);
    const out = typeof parsed.output === 'string' ? parsed.output : '';
    const err = typeof parsed.error === 'string' ? parsed.error : '';
    return { content: out || err || stripped, isError };
  }
  return { content: stripped, isError: false };
}

/**
 * Creates a fresh Hermes session and returns its id.
 */
async function createHermesSession(baseUrl, apiKey, model) {
  const response = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify(model ? { model } : {}),
  });
  if (!response.ok) {
    throw new Error(`Failed to create Hermes session (${response.status}): ${(await response.text()).slice(0, 200)}`);
  }
  const data = await response.json();
  const id = data?.session?.id;
  if (!id) {
    throw new Error('Hermes session create returned no id');
  }
  return id;
}

/**
 * Translate one gateway SSE event into the intermediate shapes that
 * HermesSessionsProvider.normalizeMessage() understands. Returns an array so a
 * single event can fan out (e.g. flush buffered reasoning before final text).
 */
function transformHermesEvent(name, data, state) {
  switch (name) {
    case 'assistant.delta':
      // Accumulate streaming text; the authoritative copy arrives on completion.
      if (typeof data.delta === 'string') {
        state.textBuf += data.delta;
      }
      return [];

    case 'tool.progress':
      // `_thinking` is reasoning; anything else is incremental tool output.
      if (data.tool_name === '_thinking' && typeof data.delta === 'string') {
        state.reasoningBuf += data.delta;
      }
      return [];

    case 'tool.started':
      // Emit the tool card immediately (in order). The output is not present on
      // the live tool events — it is paired in by run.completed via this toolId.
      return [{
        type: 'tool_use',
        toolName: data.tool_name || 'tool',
        toolInput: data.args ?? data.preview ?? null,
        toolId: `${data.run_id}__t${state.toolIndex++}`,
      }];

    case 'tool.completed':
    case 'tool.failed':
      // No result payload on these live events; output arrives in
      // run.completed.messages and is emitted there, paired by index.
      return [];

    case 'assistant.completed': {
      const out = [];
      const reasoning = state.reasoningBuf.trim();
      if (reasoning) {
        out.push({ type: 'thinking', content: reasoning });
        state.reasoningBuf = '';
      }
      const content = typeof data.content === 'string' && data.content.length
        ? data.content
        : state.textBuf;
      if (content && content.trim()) {
        out.push({ type: 'assistant_text', content });
      }
      state.textBuf = '';
      return out;
    }

    case 'error':
      return [{ type: 'error', content: data.message || 'Hermes run failed' }];

    default:
      return [];
  }
}

/**
 * Reads an SSE response body and invokes onEvent(name, dataObject) per frame.
 */
async function consumeSSE(response, onEvent, signal) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    if (signal?.aborted) {
      try { await reader.cancel(); } catch { /* ignore */ }
      break;
    }
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });

    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      let eventName = 'message';
      const dataLines = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trim());
        }
      }
      if (!dataLines.length) {
        continue;
      }
      let parsed;
      try {
        parsed = JSON.parse(dataLines.join('\n'));
      } catch {
        continue;
      }
      // onEvent returns true to signal end-of-stream (the gateway keeps the SSE
      // connection open with keepalives after `done`, so we must stop ourselves).
      if (onEvent(eventName, parsed) === true) {
        try { await reader.cancel(); } catch { /* ignore */ }
        return;
      }
    }
  }
}

/**
 * Execute a Hermes query with streaming.
 * @param {string} command - the prompt
 * @param {object} options - { sessionId, sessionSummary, model }
 * @param {WebSocket|object} ws - websocket or response writer
 */
export async function queryHermes(command, options = {}, ws) {
  const { sessionId, sessionSummary, model } = options;
  // An in-dialogue model change is persisted via the active-model endpoint
  // (not chat.send), so prefer the stored per-session override; fall back to
  // the per-send model. resolveResumeModel returns the requested model when no
  // override exists or no session id is given (new session).
  let effectiveModel = model;
  try {
    effectiveModel = (await providerModelsService.resolveResumeModel('hermes', sessionId, model)) || model;
  } catch {
    // Active-model store unavailable — fall back to the per-send model.
  }
  // Split the `provider:model` selection so the gateway resolves the right
  // provider's credentials. Empty/plain values let the gateway use its default.
  const { model: selModel, provider: selProvider } = parseModelValue(effectiveModel);
  const { baseUrl, apiKey } = gatewayConfig();

  if (!apiKey) {
    sendMessage(ws, createNormalizedMessage({ kind: 'error', content: 'Hermes gateway is not configured (set API_SERVER_KEY / HERMES_API_KEY).', sessionId: sessionId || null, provider: 'hermes' }));
    sendMessage(ws, createCompleteMessage({ provider: 'hermes', sessionId: sessionId || null, exitCode: 1 }));
    return;
  }

  const abortController = new AbortController();
  let capturedSessionId = sessionId || null;
  let terminalFailure = null;
  const state = { textBuf: '', reasoningBuf: '', toolIndex: 0 };

  try {
    // Create a session up front if the client didn't supply one.
    if (!capturedSessionId) {
      capturedSessionId = await createHermesSession(baseUrl, apiKey, selModel);
      if (typeof ws.setSessionId === 'function') {
        ws.setSessionId(capturedSessionId);
      }
      sendMessage(ws, createNormalizedMessage({ kind: 'session_created', newSessionId: capturedSessionId, sessionId: capturedSessionId, provider: 'hermes' }));
    }

    activeHermesSessions.set(capturedSessionId, { abortController, status: 'running', startedAt: new Date().toISOString() });

    const response = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(capturedSessionId)}/chat/stream`, {
      method: 'POST',
      headers: authHeaders(apiKey, { Accept: 'text/event-stream' }),
      body: JSON.stringify({
        message: command,
        ...(selModel ? { model: selModel } : {}),
        ...(selProvider ? { provider: selProvider } : {}),
      }),
      signal: abortController.signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`Hermes chat stream failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
    }

    const emit = (intermediate) => {
      const msgs = sessionsService.normalizeMessage('hermes', intermediate, capturedSessionId);
      for (const msg of msgs) {
        sendMessage(ws, msg);
      }
    };

    await consumeSSE(response, (name, data) => {
      if (name === 'done') {
        return true;
      }
      if (name === 'run.completed') {
        // Pair each tool's output (only present here) back to the live tool card
        // by index, matching the order tools were started in this run.
        const toolMsgs = (data.messages || []).filter((m) => m && m.role === 'tool');
        toolMsgs.forEach((m, i) => {
          const { content, isError } = extractToolOutput(m.content, m.tool_name);
          emit({ type: 'tool_result', toolId: `${data.run_id}__t${i}`, content, isError });
        });
        const usage = data.usage || {};
        const used = Number(usage.total_tokens) || (Number(usage.input_tokens) || 0) + (Number(usage.output_tokens) || 0);
        if (used > 0) {
          sendMessage(ws, createNormalizedMessage({
            kind: 'status',
            text: 'token_budget',
            tokenBudget: {
              used,
              total: 200000,
              inputTokens: Number(usage.input_tokens) || 0,
              outputTokens: Number(usage.output_tokens) || 0,
              breakdown: { input: Number(usage.input_tokens) || 0, output: Number(usage.output_tokens) || 0 },
            },
            sessionId: capturedSessionId,
            provider: 'hermes',
          }));
        }
        return;
      }
      const intermediates = transformHermesEvent(name, data, state);
      for (const intermediate of intermediates) {
        if (intermediate.type === 'error' && !terminalFailure) {
          terminalFailure = new Error(intermediate.content);
        }
        emit(intermediate);
      }
    }, abortController.signal);

    const session = activeHermesSessions.get(capturedSessionId);
    const runAborted = session?.status === 'aborted' || abortController.signal.aborted;
    if (!runAborted) {
      sendMessage(ws, createCompleteMessage({
        provider: 'hermes',
        sessionId: capturedSessionId,
        actualSessionId: capturedSessionId,
        exitCode: terminalFailure ? 1 : 0,
      }));
      if (terminalFailure) {
        notifyRunFailed({ userId: ws?.userId || null, provider: 'hermes', sessionId: capturedSessionId, sessionName: sessionSummary, error: terminalFailure });
      } else {
        notifyRunStopped({ userId: ws?.userId || null, provider: 'hermes', sessionId: capturedSessionId, sessionName: sessionSummary, stopReason: 'completed' });
      }
    }
  } catch (error) {
    const session = capturedSessionId ? activeHermesSessions.get(capturedSessionId) : null;
    const wasAborted = session?.status === 'aborted' || error?.name === 'AbortError' || String(error?.message || '').toLowerCase().includes('abort');
    if (!wasAborted) {
      console.error('[Hermes] Error:', error);
      sendMessage(ws, createNormalizedMessage({ kind: 'error', content: error.message, sessionId: capturedSessionId, provider: 'hermes' }));
      sendMessage(ws, createCompleteMessage({ provider: 'hermes', sessionId: capturedSessionId, exitCode: 1 }));
      notifyRunFailed({ userId: ws?.userId || null, provider: 'hermes', sessionId: capturedSessionId, sessionName: sessionSummary, error });
    }
  } finally {
    if (capturedSessionId) {
      const session = activeHermesSessions.get(capturedSessionId);
      if (session) {
        session.status = session.status === 'aborted' ? 'aborted' : 'completed';
      }
    }
  }
}

/**
 * Abort an active Hermes run.
 */
export function abortHermesSession(sessionId) {
  const session = activeHermesSessions.get(sessionId);
  if (!session) {
    return false;
  }
  session.status = 'aborted';
  try {
    session.abortController?.abort();
  } catch (error) {
    console.warn(`[Hermes] Failed to abort session ${sessionId}:`, error);
  }
  // Best-effort server-side stop is not required: aborting the SSE fetch ends
  // the client stream, and the gateway run completes independently.
  return true;
}

export function isHermesSessionActive(sessionId) {
  return activeHermesSessions.get(sessionId)?.status === 'running';
}

export function getActiveHermesSessions() {
  const sessions = [];
  for (const [id, session] of activeHermesSessions.entries()) {
    if (session.status === 'running') {
      sessions.push({ id, status: session.status, startedAt: session.startedAt });
    }
  }
  return sessions;
}

function sendMessage(ws, data) {
  try {
    if (ws.isSSEStreamWriter || ws.isWebSocketWriter) {
      ws.send(data);
    } else if (typeof ws.send === 'function') {
      ws.send(JSON.stringify(data));
    }
  } catch (error) {
    console.error('[Hermes] Error sending message:', error);
  }
}

// Periodically drop completed sessions from the active map. `unref()` so this
// timer never keeps the process (or a CLI harness) alive on its own.
setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000;
  for (const [id, session] of activeHermesSessions.entries()) {
    if (session.status !== 'running' && now - new Date(session.startedAt).getTime() > maxAge) {
      activeHermesSessions.delete(id);
    }
  }
}, 5 * 60 * 1000).unref();

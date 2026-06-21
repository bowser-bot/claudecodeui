/**
 * Hermes gateway HTTP client
 * ==========================
 *
 * Unlike the other providers (which spawn a local CLI/SDK and read on-disk
 * transcripts), Hermes runs remotely behind its OpenAI-compatible "api_server"
 * gateway. Every Hermes provider sub-module talks to that gateway over HTTP:
 *
 *   - chat        POST /api/sessions/{id}/chat/stream   (SSE)
 *   - sessions    GET  /api/sessions , /api/sessions/{id}/messages
 *   - models      GET  /v1/models
 *   - auth        GET  /health
 *   - skills      GET  /v1/skills
 *
 * Configuration comes from the environment so a deployment can point CloudCLI
 * at a local gateway (127.0.0.1:8642) or a remote one over Tailscale.
 */

const DEFAULT_BASE_URL = 'http://127.0.0.1:8642';

export type HermesGatewayConfig = {
  baseUrl: string;
  apiKey: string;
};

/**
 * Resolves the Hermes gateway base URL + API key from the environment.
 * `HERMES_API_KEY` mirrors the gateway's `API_SERVER_KEY`.
 */
export function getHermesGatewayConfig(): HermesGatewayConfig {
  const baseUrl = (process.env.HERMES_GATEWAY_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const apiKey = process.env.HERMES_API_KEY || process.env.API_SERVER_KEY || '';
  return { baseUrl, apiKey };
}

export function isHermesConfigured(): boolean {
  return Boolean(getHermesGatewayConfig().apiKey);
}

/**
 * Performs an authenticated JSON request against the gateway. Returns the parsed
 * body, or throws with a readable message on transport/HTTP errors.
 */
export async function hermesFetchJson<T = unknown>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 15000,
): Promise<T> {
  const { baseUrl, apiKey } = getHermesGatewayConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Hermes gateway ${path} → ${response.status}: ${text.slice(0, 200)}`);
    }
    return (text ? JSON.parse(text) : {}) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Synthetic project path used to group all Hermes sessions under one project in
 * CloudCLI's project-centric session list. Hermes tools execute server-side in
 * the gateway, so there is no real local working directory.
 */
export function hermesProjectPath(): string {
  return process.env.HERMES_HOME || `${process.env.HOME || ''}/.hermes`;
}

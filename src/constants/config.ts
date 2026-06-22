/**
 * Environment Flag: Is Platform
 * Indicates if the app is running in Platform mode (hosted) or OSS mode (self-hosted)
 */
export const IS_PLATFORM = import.meta.env.VITE_IS_PLATFORM === 'true';

/**
 * For empty shell instances where no project is provided,
 * we use a default project object to ensure the shell can still function.
 * This prevents errors related to missing project data.
 *
 * `projectId` is set to a well-known sentinel ('default') because the empty
 * shell doesn't correspond to any real project row in the database; any API
 * call that routes through this placeholder must tolerate a missing match.
 */
export const DEFAULT_PROJECT_FOR_EMPTY_SHELL = {
  projectId: 'default',
  displayName: 'default',
  fullPath: IS_PLATFORM ? '/workspace' : '',
  path: IS_PLATFORM ? '/workspace' : '',
};

/**
 * Backend origin resolution.
 *
 * The web build talks to its own origin (relative URLs), exactly as before.
 * The native (Capacitor) build is served from a local file/scheme, so it must
 * point API + WebSocket traffic at a remote CloudCLI server. Resolution order:
 *   1. a user override saved in localStorage (Settings → Server URL)
 *   2. a build-time default baked in via VITE_DEFAULT_SERVER_ORIGIN
 *   3. '' → same-origin (web default; unchanged behaviour)
 */
const SERVER_ORIGIN_KEY = 'cloudcli_server_origin';
const BUILD_DEFAULT_ORIGIN = String(import.meta.env.VITE_DEFAULT_SERVER_ORIGIN || '')
  .trim()
  .replace(/\/+$/, '');

export function getServerOrigin(): string {
  try {
    const stored = (localStorage.getItem(SERVER_ORIGIN_KEY) || '').trim().replace(/\/+$/, '');
    return stored || BUILD_DEFAULT_ORIGIN;
  } catch {
    return BUILD_DEFAULT_ORIGIN;
  }
}

export function setServerOrigin(origin: string): void {
  try {
    const value = String(origin || '').trim().replace(/\/+$/, '');
    if (value) {
      localStorage.setItem(SERVER_ORIGIN_KEY, value);
    } else {
      localStorage.removeItem(SERVER_ORIGIN_KEY);
    }
  } catch {
    /* ignore storage failures (private mode / quota) */
  }
}

/** Prefix a relative `/api/...` path with the configured backend origin. */
export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const origin = getServerOrigin();
  if (!origin) return path;
  return `${origin}${path.startsWith('/') ? path : `/${path}`}`;
}

/** WebSocket origin (ws/wss) for the configured backend, else same-origin. */
export function getWsOrigin(): string {
  const origin = getServerOrigin();
  if (origin) return origin.replace(/^http/i, 'ws'); // http→ws, https→wss
  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const host = typeof window !== 'undefined' ? window.location.host : '';
  return `${isHttps ? 'wss:' : 'ws:'}//${host}`;
}
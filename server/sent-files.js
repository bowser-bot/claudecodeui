/**
 * Registry for files an agent sends to the user via the `send_user_file` tool.
 *
 * A tool call registers an absolute path under a random, user-scoped token; the
 * frontend downloads it through GET /api/files/sent/:token (auth required). The
 * agent already has full filesystem access as the server user, so this is only a
 * delivery channel — not a new capability. Entries expire so paths aren't held
 * open indefinitely.
 */
import { randomBytes } from 'node:crypto';
import { statSync } from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 500 * 1024 * 1024; // 500 MB
const TTL_MS = 24 * 60 * 60 * 1000; // 24h

/** token -> { absPath, name, size, userId, expiresAt } */
const registry = new Map();

function sweep() {
  const now = Date.now();
  for (const [token, entry] of registry) {
    if (entry.expiresAt <= now) registry.delete(token);
  }
}

/**
 * Validate + register a file for download. Throws on missing / non-file / oversized.
 * @returns {{ token: string, name: string, size: number }}
 */
export function registerSentFile(userId, filePath) {
  const absPath = path.resolve(String(filePath || ''));
  const stat = statSync(absPath); // throws ENOENT if missing
  if (!stat.isFile()) {
    throw new Error(`Not a regular file: ${absPath}`);
  }
  if (stat.size > MAX_BYTES) {
    throw new Error(`File too large: ${stat.size} bytes (max ${MAX_BYTES})`);
  }
  sweep();
  const token = randomBytes(18).toString('base64url');
  const name = path.basename(absPath);
  registry.set(token, {
    absPath,
    name,
    size: stat.size,
    userId: userId ?? null,
    expiresAt: Date.now() + TTL_MS,
  });
  return { token, name, size: stat.size };
}

/**
 * Look up a registered file, enforcing user ownership when both ids are known.
 * @returns {{ absPath: string, name: string, size: number } | null}
 */
export function getSentFile(token, userId) {
  sweep();
  const entry = registry.get(String(token || ''));
  if (!entry) return null;
  if (entry.userId != null && userId != null && String(entry.userId) !== String(userId)) {
    return null;
  }
  return entry;
}

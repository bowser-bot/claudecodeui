import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';
import { normalizeSessionName } from '@/shared/utils.js';

import { hermesFetchJson, hermesProjectPath, isHermesConfigured } from './hermes-client.js';

const UNTITLED = 'Untitled Hermes Session';

type HermesSessionRow = {
  id: string;
  title?: string | null;
  preview?: string | null;
  source?: string | null;
  started_at?: number | null;
  last_active?: number | null;
  ended_at?: number | null;
};

function toIso(ts: number | null | undefined): string | undefined {
  return typeof ts === 'number' && Number.isFinite(ts) ? new Date(ts * 1000).toISOString() : undefined;
}

/**
 * Indexes Hermes sessions by polling the gateway's session list. Hermes sessions
 * live remotely, so there is no local artifact to watch — `synchronize()` is the
 * only entry point (it runs on the scheduled full scan).
 */
export class HermesSessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'hermes' as const;

  async synchronize(since?: Date): Promise<number> {
    if (!isHermesConfigured()) {
      return 0;
    }

    let rows: HermesSessionRow[] = [];
    try {
      const data = await hermesFetchJson<{ data?: HermesSessionRow[] }>('/api/sessions?limit=200');
      rows = Array.isArray(data.data) ? data.data : [];
    } catch (error) {
      throw new Error(`Hermes session sync failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    const sinceMs = since ? since.getTime() : 0;
    const projectPath = hermesProjectPath();
    let processed = 0;

    for (const row of rows) {
      if (!row.id) {
        continue;
      }
      const lastActiveMs = (row.last_active ?? row.ended_at ?? row.started_at ?? 0) * 1000;
      if (sinceMs && lastActiveMs && lastActiveMs < sinceMs) {
        continue;
      }

      const name = normalizeSessionName(row.title || row.preview || undefined, UNTITLED);
      const existing = sessionsDb.getSessionByProviderSessionId(row.id) ?? sessionsDb.getSessionById(row.id);
      if (existing && existing.custom_name === UNTITLED && name !== UNTITLED) {
        sessionsDb.updateSessionCustomName(existing.session_id, name);
      }

      sessionsDb.createSession(
        row.id,
        this.provider,
        projectPath,
        name,
        toIso(row.started_at),
        toIso(row.last_active ?? row.ended_at),
        null,
      );
      processed += 1;
    }

    return processed;
  }

  /**
   * Hermes has no local session files; file-level sync is a no-op.
   */
  async synchronizeFile(): Promise<string | null> {
    return null;
  }
}

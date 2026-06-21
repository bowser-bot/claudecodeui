import type { IProviderSkills } from '@/shared/interfaces.js';
import type { ProviderSkill, ProviderSkillListOptions } from '@/shared/types.js';

import { hermesFetchJson, isHermesConfigured } from './hermes-client.js';

type HermesSkillRow = { name?: string; description?: string | null; category?: string | null };

/**
 * Lists skills installed for the Hermes gateway agent (GET /v1/skills).
 */
export class HermesSkillsProvider implements IProviderSkills {
  async listSkills(_options?: ProviderSkillListOptions): Promise<ProviderSkill[]> {
    if (!isHermesConfigured()) {
      return [];
    }
    try {
      const data = await hermesFetchJson<{ data?: HermesSkillRow[] }>('/v1/skills');
      const rows = Array.isArray(data.data) ? data.data : [];
      return rows
        .filter((row): row is HermesSkillRow & { name: string } => typeof row.name === 'string' && row.name.length > 0)
        .map((row) => ({
          provider: 'hermes' as const,
          name: row.name,
          description: row.description || '',
          command: `/${row.name}`,
          scope: 'user' as const,
          sourcePath: `hermes://skills/${row.name}`,
        }));
    } catch {
      return [];
    }
  }
}

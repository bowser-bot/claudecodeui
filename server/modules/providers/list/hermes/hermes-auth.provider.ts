import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';

import { getHermesGatewayConfig, hermesFetchJson } from './hermes-client.js';

/**
 * "Installed" means the Hermes gateway is reachable; "authenticated" means our
 * API key is accepted. We probe `/health` (public) for reachability and
 * `/v1/models` (auth-required) to validate the key.
 */
export class HermesProviderAuth implements IProviderAuth {
  async getStatus(): Promise<ProviderAuthStatus> {
    const { baseUrl, apiKey } = getHermesGatewayConfig();

    if (!apiKey) {
      return {
        installed: false,
        provider: 'hermes',
        authenticated: false,
        email: null,
        method: null,
        error: 'Hermes gateway API key not configured (set HERMES_API_KEY).',
      };
    }

    let reachable = false;
    try {
      const health = await hermesFetchJson<{ status?: string }>('/health', {}, 5000);
      reachable = health?.status === 'ok';
    } catch {
      reachable = false;
    }

    if (!reachable) {
      return {
        installed: false,
        provider: 'hermes',
        authenticated: false,
        email: null,
        method: null,
        error: `Hermes gateway not reachable at ${baseUrl}.`,
      };
    }

    try {
      await hermesFetchJson('/v1/models', {}, 5000);
      return { installed: true, provider: 'hermes', authenticated: true, email: 'Hermes Gateway', method: 'api_key' };
    } catch (error) {
      return {
        installed: true,
        provider: 'hermes',
        authenticated: false,
        email: null,
        method: null,
        error: error instanceof Error ? error.message : 'Invalid Hermes API key',
      };
    }
  }
}

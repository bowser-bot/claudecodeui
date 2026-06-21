import type { IProviderMcp } from '@/shared/interfaces.js';
import type { McpScope, ProviderMcpServer, UpsertProviderMcpServerInput } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

/**
 * Hermes manages its own MCP servers through the `hermes mcp` CLI and the
 * gateway does not expose MCP management over the api_server surface. CloudCLI
 * therefore presents Hermes MCP as read-only/empty rather than editing remote
 * config it cannot safely round-trip.
 */
export class HermesMcpProvider implements IProviderMcp {
  async listServers(): Promise<Record<McpScope, ProviderMcpServer[]>> {
    return { user: [], local: [], project: [] };
  }

  async listServersForScope(): Promise<ProviderMcpServer[]> {
    return [];
  }

  async upsertServer(_input: UpsertProviderMcpServerInput): Promise<ProviderMcpServer> {
    throw new AppError('Managing Hermes MCP servers from CloudCLI is not supported; use `hermes mcp`.', {
      code: 'HERMES_MCP_READONLY',
      statusCode: 400,
    });
  }

  async removeServer(
    input: { name: string; scope?: McpScope; workspacePath?: string },
  ): Promise<{ removed: boolean; provider: 'hermes'; name: string; scope: McpScope }> {
    return { removed: false, provider: 'hermes', name: input.name, scope: input.scope ?? 'user' };
  }
}

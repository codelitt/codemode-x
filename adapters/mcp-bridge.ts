import type { Adapter, ToolDefinition, AdapterOptions } from '../src/types.js';

/**
 * MCP Bridge adapter — wraps an existing MCP server's tools as
 * codemode-x ToolDefinitions, letting cmx_execute call through to them.
 *
 * Phase 5: Not yet implemented.
 */
export const mcpBridgeAdapter: Adapter = {
  name: 'mcp-bridge',

  async parse(_source: unknown, _opts?: AdapterOptions): Promise<ToolDefinition[]> {
    throw new Error(
      'MCP Bridge adapter is not yet implemented (Phase 5). ' +
      'Use the express or openapi adapter for now.'
    );
  },
};

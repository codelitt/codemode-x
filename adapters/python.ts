import type { Adapter, ToolDefinition, AdapterOptions } from '../src/types.js';

/**
 * Python adapter — introspects Python modules via subprocess to extract
 * function signatures as ToolDefinitions.
 *
 * Phase 3: Not yet implemented.
 */
export const pythonAdapter: Adapter = {
  name: 'python',

  async parse(_source: unknown, _opts?: AdapterOptions): Promise<ToolDefinition[]> {
    throw new Error(
      'Python adapter is not yet implemented (Phase 3). ' +
      'Use the express or openapi adapter for now.'
    );
  },
};

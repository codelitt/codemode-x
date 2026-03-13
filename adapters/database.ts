import type { Adapter, ToolDefinition, AdapterOptions } from '../src/types.js';

/**
 * Database adapter — introspects a database schema to generate
 * read-only query tools as ToolDefinitions.
 *
 * Phase 5: Not yet implemented.
 */
export const databaseAdapter: Adapter = {
  name: 'database',

  async parse(_source: unknown, _opts?: AdapterOptions): Promise<ToolDefinition[]> {
    throw new Error(
      'Database adapter is not yet implemented (Phase 5). ' +
      'Use the express or openapi adapter for now.'
    );
  },
};

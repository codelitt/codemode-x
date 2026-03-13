#!/usr/bin/env node

/**
 * Claude Code MCP plugin entry point for codemode-x.
 * Loads the config, initializes adapters, and starts the MCP server on stdio.
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Try to import the compiled server
async function main() {
  try {
    const { CmxServer, loadConfig } = await import('../dist/src/server.js');

    const configPath = process.argv[2] || undefined;
    const config = await loadConfig(configPath);

    const server = new CmxServer(config);
    await server.start();
  } catch (err) {
    console.error('[cmx] Failed to start:', err.message);
    console.error('[cmx] Make sure to run `npm run build` first');
    process.exit(1);
  }
}

main();

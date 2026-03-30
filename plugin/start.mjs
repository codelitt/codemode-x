#!/usr/bin/env node

/**
 * Claude Code MCP plugin entry point for codemode-x.
 * Loads the config, initializes adapters, and starts the MCP server on stdio.
 */

import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

process.on('unhandledRejection', (err) => {
  process.stderr.write(`[cmx] unhandledRejection: ${err}\n`);
});
process.on('uncaughtException', (err) => {
  process.stderr.write(`[cmx] uncaughtException: ${err?.message ?? err}\n`);
});

async function main() {
  try {
    const { CmxServer, loadConfig } = await import(resolve(__dirname, '../dist/src/server.js'));

    // Config path: CLI arg, or auto-detect from CLAUDE_PROJECT_DIR / cwd
    const configPath = process.argv[2] || undefined;
    const config = await loadConfig(configPath);

    const server = new CmxServer(config);
    await server.start();
  } catch (err) {
    console.error('[cmx] Failed to start:', err.message);

    if (err.message.includes('No codemode-x config found')) {
      console.error('[cmx] Run `npx codemode-x init` in your project directory to create a config.');
    } else {
      console.error('[cmx] Make sure to run `npm run build` first.');
    }

    process.exit(1);
  }
}

main();

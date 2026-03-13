#!/usr/bin/env node

/**
 * CLI for codemode-x.
 * Usage:
 *   npx codemode-x init          — interactive setup wizard
 *   npx codemode-x start          — start the MCP server
 *   npx codemode-x test           — test config by discovering tools
 */

import { resolve, relative } from 'path';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { createInterface } from 'readline';

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  switch (command) {
    case 'init':
      await runInit();
      break;
    case 'start':
      await runStart();
      break;
    case 'test':
      await runTest();
      break;
    default:
      printUsage();
  }
}

function printUsage() {
  console.log(`
codemode-x — compress any API into 2 MCP tools

Commands:
  init     Interactive setup wizard
  start    Start the MCP server
  test     Test config by discovering and listing tools

Usage:
  npx codemode-x init
  npx codemode-x start [config-path]
  npx codemode-x test [config-path]
`.trim());
}

// ─── Init Wizard ─────────────────────────────────────────────────

async function runInit() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string, def?: string): Promise<string> =>
    new Promise(resolve => {
      const suffix = def ? ` (${def})` : '';
      rl.question(`${q}${suffix}: `, answer => resolve(answer.trim() || def || ''));
    });

  console.log('\n🔧 codemode-x setup\n');

  // Detect what's in the current directory
  const cwd = process.cwd();
  const detected = detectProject(cwd);

  const sdkName = await ask('SDK name (how Claude refers to your API)', detected.suggestedName);

  const domains: Array<{ name: string; adapter: string; source: string; baseUrl?: string }> = [];

  // Detect Express servers
  if (detected.expressFiles.length > 0) {
    console.log(`\nFound Express server(s): ${detected.expressFiles.join(', ')}`);
    for (const file of detected.expressFiles) {
      const use = await ask(`  Add ${file} as a domain? (y/n)`, 'y');
      if (use.toLowerCase() === 'y') {
        const name = await ask('    Domain name', 'api');
        const baseUrl = await ask('    Base URL', 'http://localhost:3000');
        domains.push({ name, adapter: 'express', source: `./${file}`, baseUrl });
      }
    }
  }

  // Detect OpenAPI specs
  if (detected.openapiFiles.length > 0) {
    console.log(`\nFound OpenAPI spec(s): ${detected.openapiFiles.join(', ')}`);
    for (const file of detected.openapiFiles) {
      const use = await ask(`  Add ${file} as a domain? (y/n)`, 'y');
      if (use.toLowerCase() === 'y') {
        const name = await ask('    Domain name', 'api');
        const baseUrl = await ask('    Base URL', 'http://localhost:3000');
        domains.push({ name, adapter: 'openapi', source: `./${file}`, baseUrl });
      }
    }
  }

  // Manual entry if nothing detected
  if (domains.length === 0) {
    console.log('\nNo APIs auto-detected. Add one manually:');
    const adapter = await ask('  Adapter (express/openapi/markdown)', 'express');
    const source = await ask('  Source file path');
    const name = await ask('  Domain name', 'api');
    const baseUrl = adapter !== 'markdown' ? await ask('  Base URL', 'http://localhost:3000') : undefined;
    domains.push({ name, adapter, source, baseUrl });
  }

  // Ask about docs
  const addDocs = await ask('\nIndex markdown docs? (y/n)', 'n');
  if (addDocs.toLowerCase() === 'y') {
    const docsPath = await ask('  Docs path (glob)', './docs/**/*.md');
    domains.push({ name: 'docs', adapter: 'markdown', source: docsPath });
  }

  // Generate config
  const configContent = generateConfig(sdkName, domains);
  const configPath = resolve(cwd, 'codemode-x.config.js');

  writeFileSync(configPath, configContent, 'utf-8');
  console.log(`\n✅ Config written to ${relative(cwd, configPath)}`);

  // Generate Claude Code MCP settings snippet
  console.log(`\nTo add to Claude Code, run:`);
  console.log(`  claude mcp add codemode-x -- node ${resolve(__dirname, '../plugin/start.mjs')}`);
  console.log(`\nOr add to .claude/settings.json:`);
  console.log(JSON.stringify({
    mcpServers: {
      'codemode-x': {
        command: 'node',
        args: [resolve(__dirname, '../plugin/start.mjs')],
      },
    },
  }, null, 2));

  rl.close();
}

function detectProject(cwd: string): {
  suggestedName: string;
  expressFiles: string[];
  openapiFiles: string[];
} {
  const files = readdirSync(cwd);
  const expressFiles: string[] = [];
  const openapiFiles: string[] = [];

  for (const file of files) {
    if (file === 'node_modules' || file.startsWith('.')) continue;

    // Detect Express servers by looking for common patterns
    if (file.endsWith('.js') || file.endsWith('.ts') || file.endsWith('.mjs')) {
      try {
        const content = readFileSync(resolve(cwd, file), 'utf-8');
        if (content.includes('express()') && (content.includes('app.get') || content.includes('app.post'))) {
          expressFiles.push(file);
        }
      } catch {}
    }

    // Detect OpenAPI specs
    if (file.endsWith('.json')) {
      try {
        const content = readFileSync(resolve(cwd, file), 'utf-8');
        if (content.includes('"openapi"') || content.includes('"swagger"')) {
          openapiFiles.push(file);
        }
      } catch {}
    }
  }

  // Suggest name from package.json or directory
  let suggestedName = 'myapp';
  try {
    const pkg = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf-8'));
    suggestedName = pkg.name?.replace(/[^a-zA-Z]/g, '') || suggestedName;
  } catch {
    suggestedName = cwd.split('/').pop()?.replace(/[^a-zA-Z]/g, '') || suggestedName;
  }

  return { suggestedName, expressFiles, openapiFiles };
}

function generateConfig(
  sdkName: string,
  domains: Array<{ name: string; adapter: string; source: string; baseUrl?: string }>
): string {
  const domainEntries = domains.map(d => {
    const lines = [
      `    {`,
      `      name: '${d.name}',`,
      `      adapter: '${d.adapter}',`,
      `      source: '${d.source}',`,
    ];
    if (d.baseUrl) {
      lines.push(`      baseUrl: '${d.baseUrl}',`);
    }
    if (d.adapter !== 'markdown') {
      lines.push(`      auth: { scope: 'readwrite' },`);
    }
    lines.push(`    }`);
    return lines.join('\n');
  });

  return `/** @type {import('codemode-x/src/types.js').CmxConfig} */
export default {
  sdkName: '${sdkName}',
  domains: [
${domainEntries.join(',\n')}
  ],
};
`;
}

// ─── Start Server ────────────────────────────────────────────────

async function runStart() {
  const configPath = args[1] || undefined;
  const { CmxServer, loadConfig } = await import('./server.js');
  const config = await loadConfig(configPath);
  const server = new CmxServer(config);
  await server.start();
}

// ─── Test Config ─────────────────────────────────────────────────

async function runTest() {
  const configPath = args[1] || undefined;
  const { loadConfig } = await import('./server.js');
  const { ToolRegistry } = await import('./registry.js');
  const { SearchIndex } = await import('./search.js');
  const { formatSearchResults } = await import('./typegen.js');
  const { expressAdapter } = await import('../adapters/express.js');
  const { openapiAdapter } = await import('../adapters/openapi.js');
  const { markdownAdapter } = await import('../adapters/markdown.js');

  const config = await loadConfig(configPath);

  console.log(`\n📦 Testing config: sdkName="${config.sdkName}"\n`);

  const registry = new ToolRegistry();
  registry.registerAdapter(expressAdapter);
  registry.registerAdapter(openapiAdapter);
  registry.registerAdapter(markdownAdapter);

  for (const domain of config.domains) {
    try {
      const count = await registry.loadDomain(domain);
      console.log(`✅ ${domain.name} (${domain.adapter}): ${count} tools discovered`);

      const tools = registry.getToolsByDomain(domain.name);
      for (const t of tools) {
        const rw = t.readOnly ? '' : ' [WRITE]';
        const route = t.route ? ` → ${t.method} ${t.route}` : '';
        console.log(`   sdk.${domain.name}.${t.name}()${route}${rw}`);
      }
    } catch (err: any) {
      console.log(`❌ ${domain.name} (${domain.adapter}): ${err.message}`);
    }
    console.log();
  }

  // Test search
  const allTools = registry.getAllTools();
  const index = new SearchIndex();
  index.index(allTools);

  console.log(`🔍 Search index: ${index.size} tools indexed\n`);

  // Demo search
  const testQuery = config.domains[0]?.name || 'api';
  const results = index.search(testQuery);
  if (results.length > 0) {
    console.log(`Sample search for "${testQuery}":`);
    console.log(formatSearchResults(config.sdkName, results));
  }

  console.log(`\n✅ Config is valid. ${allTools.length} total tools ready.`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});

/**
 * Live end-to-end test — runs against a real Express server.
 *
 * Usage:
 *   1. Start your Express server (e.g., cd rent-comps-backend && node server.js)
 *   2. Run: npx tsx tests/live-e2e.ts [server-path] [base-url]
 *
 * Defaults:
 *   server-path: ./server.js (or pass your Express server path as arg)
 *   base-url: http://localhost:3001
 */

import { resolve } from 'path';
import { ToolRegistry } from '../src/registry.js';
import { SearchIndex } from '../src/search.js';
import { SandboxExecutor } from '../src/executor.js';
import { formatSearchResults } from '../src/typegen.js';
import { buildSdkProxy, flattenProxy } from '../src/proxy.js';
import { CredentialStore } from '../src/auth.js';
import { expressAdapter } from '../adapters/express.js';
import type { ToolDefinition } from '../src/types.js';

const serverPath = process.argv[2] || resolve(process.cwd(), './server.js');
const baseUrl = process.argv[3] || 'http://localhost:3001';

type ToolImplementation = (args: Record<string, unknown>) => Promise<unknown>;

async function main() {
  console.log('═══ codemode-x Live E2E Test ═══\n');
  console.log(`Server source: ${serverPath}`);
  console.log(`Base URL: ${baseUrl}\n`);

  // Step 1: Check server is reachable
  console.log('1. Checking server connectivity...');
  try {
    const resp = await fetch(`${baseUrl}/api/properties`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    console.log(`   ✅ Server responding (HTTP ${resp.status})\n`);
  } catch (err: any) {
    console.log(`   ❌ Server not reachable at ${baseUrl}: ${err.message}`);
    console.log('   Start your server first, then re-run this test.\n');
    process.exit(1);
  }

  // Step 2: Discover routes
  console.log('2. Discovering Express routes...');
  const registry = new ToolRegistry();
  registry.registerAdapter(expressAdapter);
  const count = await registry.loadDomain({
    name: 'rentComps',
    adapter: 'express',
    source: serverPath,
    baseUrl,
    auth: { scope: 'readwrite' },
  });
  console.log(`   ✅ Discovered ${count} tools\n`);

  const tools = registry.getToolsByDomain('rentComps');
  for (const t of tools) {
    console.log(`   sdk.rentComps.${t.name}() → ${t.method} ${t.route}`);
  }
  console.log();

  // Step 3: Build search index
  console.log('3. Building search index...');
  const index = new SearchIndex();
  index.index(tools);
  console.log(`   ✅ Indexed ${index.size} tools\n`);

  // Step 4: Test search
  console.log('4. Testing search...');
  const searchResults = index.search('properties');
  console.log(`   Query "properties" → ${searchResults.length} results`);
  console.log(formatSearchResults('carbon', searchResults.slice(0, 3)));
  console.log();

  // Step 5: Build SDK proxy with real HTTP implementations
  console.log('5. Building SDK proxy with real HTTP backends...');
  const implementations = new Map<string, ToolImplementation>();
  for (const tool of tools) {
    implementations.set(`rentComps.${tool.name}`, buildHttpImpl(tool, baseUrl));
  }
  const credentials = new CredentialStore();
  const callLog: any[] = [];
  const proxy = buildSdkProxy(registry, implementations, credentials, callLog);
  const flatFns = flattenProxy(proxy);
  console.log(`   ✅ ${implementations.size} HTTP implementations ready\n`);

  // Step 6: Execute real code against real API
  console.log('6. Executing code against live API...\n');
  const executor = new SandboxExecutor();

  // Test A: List properties
  console.log('   --- Test A: List properties ---');
  const resultA = await executor.execute(
    `const props = await sdk.rentComps.getProperties();
     console.log("Found " + props.length + " properties");
     return props.slice(0, 3).map(p => ({ id: p.id, name: p.name }));`,
    flatFns
  );
  printResult(resultA);

  // Test B: Get a specific property (if any exist)
  if (resultA.success && Array.isArray(resultA.result) && resultA.result.length > 0) {
    const firstId = resultA.result[0].id;
    console.log(`   --- Test B: Get property #${firstId} ---`);
    const resultB = await executor.execute(
      `const prop = await sdk.rentComps.getPropertiesById({ id: ${firstId} });
       console.log("Property: " + prop.name);
       return prop;`,
      flatFns
    );
    printResult(resultB);
  }

  console.log('\n═══ E2E Test Complete ═══');
  console.log(`Total API calls made: ${callLog.length}`);
  process.exit(0);
}

function buildHttpImpl(tool: ToolDefinition, base: string): ToolImplementation {
  return async (params: Record<string, unknown>) => {
    let url = `${base}${tool.route}`;
    const method = tool.method ?? 'GET';

    const routeParams = (tool.route?.match(/:(\w+)/g) || []).map(p => p.slice(1));
    for (const rp of routeParams) {
      if (params[rp] !== undefined) {
        url = url.replace(`:${rp}`, String(params[rp]));
      }
    }

    if (method === 'GET') {
      const qs = Object.entries(params)
        .filter(([k]) => !routeParams.includes(k))
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
      if (qs) url += `?${qs}`;
    }

    const bodyParams: Record<string, unknown> = {};
    if (method !== 'GET' && method !== 'DELETE') {
      for (const [k, v] of Object.entries(params)) {
        if (!routeParams.includes(k)) bodyParams[k] = v;
      }
    }

    const opts: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (method !== 'GET' && method !== 'DELETE' && Object.keys(bodyParams).length > 0) {
      opts.body = JSON.stringify(bodyParams);
    }

    const resp = await fetch(url, opts);
    const ct = resp.headers.get('content-type') ?? '';
    return ct.includes('json') ? resp.json() : resp.text();
  };
}

function printResult(result: any) {
  if (result.logs.length > 0) {
    for (const log of result.logs) console.log(`   📝 ${log}`);
  }
  if (result.success) {
    const preview = JSON.stringify(result.result, null, 2);
    const lines = preview.split('\n');
    const truncated = lines.length > 15 ? lines.slice(0, 15).join('\n') + '\n   ...' : preview;
    console.log(`   ✅ Result (${result.durationMs}ms):`);
    console.log(`   ${truncated.replace(/\n/g, '\n   ')}\n`);
  } else {
    console.log(`   ❌ Error: ${result.error}\n`);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

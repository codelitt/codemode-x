import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { resolve, dirname } from 'path';
import { existsSync } from 'fs';

import type { CmxConfig, ToolDefinition, HeaderAuthConfig } from './types.js';
import { ToolRegistry } from './registry.js';
import { SearchIndex } from './search.js';
import { formatSearchResults } from './typegen.js';
import { SandboxExecutor, DirectExecutor } from './executor.js';
import { buildSdkProxy, flattenProxy, type ProxyCallResult } from './proxy.js';
import { CredentialStore } from './auth.js';
import { expressAdapter } from '../adapters/express.js';
import { openapiAdapter } from '../adapters/openapi.js';
import { markdownAdapter } from '../adapters/markdown.js';
import { lambdaAdapter, buildLambdaInvoker } from '../adapters/lambda.js';
import { databaseAdapter, buildDatabaseQuerier } from '../adapters/database.js';
import { pythonAdapter, buildPythonInvoker } from '../adapters/python.js';
import { mcpBridgeAdapter, buildMcpBridgeInvoker } from '../adapters/mcp-bridge.js';

type ToolImplementation = (args: Record<string, unknown>) => Promise<unknown>;

export class CmxServer {
  private server!: McpServer;
  private registry: ToolRegistry;
  private searchIndex: SearchIndex;
  private executor: SandboxExecutor | DirectExecutor;
  private credentials: CredentialStore;
  private implementations: Map<string, ToolImplementation> = new Map();
  private config: CmxConfig;
  private callLog: ProxyCallResult[] = [];

  constructor(config: CmxConfig, opts?: { useDirectExecutor?: boolean }) {
    this.config = config;
    this.registry = new ToolRegistry();
    this.searchIndex = new SearchIndex();
    this.credentials = new CredentialStore();
    this.executor = opts?.useDirectExecutor ? new DirectExecutor() : new SandboxExecutor();

    // Register built-in adapters
    this.registry.registerAdapter(expressAdapter);
    this.registry.registerAdapter(openapiAdapter);
    this.registry.registerAdapter(markdownAdapter);
    this.registry.registerAdapter(lambdaAdapter);
    this.registry.registerAdapter(databaseAdapter);
    this.registry.registerAdapter(pythonAdapter);
    this.registry.registerAdapter(mcpBridgeAdapter);
  }

  /** Load all domains from config and build the search index */
  async initialize(): Promise<void> {
    for (const domain of this.config.domains) {
      const count = await this.registry.loadDomain(domain);
      console.error(`[cmx] Loaded ${count} tools from ${domain.name} (${domain.adapter})`);
    }

    // Index all tools for search
    const allTools = this.registry.getAllTools();
    this.searchIndex.index(allTools);
    console.error(`[cmx] Indexed ${allTools.length} tools across ${this.registry.domains.length} domains`);

    // Create MCP server with dynamic instructions built from loaded domains
    const instructions = this.buildInstructions();
    this.server = new McpServer(
      { name: 'codemode-x', version: '0.4.0' },
      { instructions },
    );

    // Register the 2 meta-tools with the MCP server
    this.registerTools();

    // Build implementations for HTTP-based tools (Express, OpenAPI)
    for (const domain of this.config.domains) {
      if (domain.adapter === 'express' || domain.adapter === 'openapi') {
        const tools = this.registry.getToolsByDomain(domain.name);
        const baseUrl = domain.baseUrl ?? 'http://localhost:3001';
        const headerAuth = domain.auth && 'type' in domain.auth && domain.auth.type === 'header'
          ? domain.auth as HeaderAuthConfig
          : undefined;
        for (const tool of tools) {
          this.implementations.set(
            `${domain.name}.${tool.name}`,
            buildHttpImplementation(tool, baseUrl, headerAuth)
          );
        }
      } else if (domain.adapter === 'lambda') {
        // Lambda tools invoke functions via AWS SDK
        const tools = this.registry.getToolsByDomain(domain.name);
        const region = String(domain.source);
        for (const tool of tools) {
          const fnName = tool.route!; // Function name stored in route field
          const invoker = await buildLambdaInvoker(region, fnName);
          this.implementations.set(
            `${domain.name}.${tool.name}`,
            invoker
          );
        }
      } else if (domain.adapter === 'database') {
        // Database tools query SQLite directly
        const writable = domain.options?.writable === true;
        const querier = await buildDatabaseQuerier(String(domain.source), writable);
        const tools = this.registry.getToolsByDomain(domain.name);
        for (const tool of tools) {
          const impl = querier.get(tool.name);
          if (impl) {
            this.implementations.set(`${domain.name}.${tool.name}`, impl);
          }
        }
      } else if (domain.adapter === 'python') {
        // Python tools invoke functions via subprocess
        const tools = this.registry.getToolsByDomain(domain.name);
        const pythonBin = String(domain.options?.python ?? 'python3');
        for (const tool of tools) {
          const invoker = buildPythonInvoker(String(domain.source), tool.route!, pythonBin);
          this.implementations.set(`${domain.name}.${tool.name}`, invoker);
        }
      } else if (domain.adapter === 'mcp-bridge') {
        // MCP bridge tools proxy through to an existing MCP server
        const bridge = await buildMcpBridgeInvoker(domain.source);
        const tools = this.registry.getToolsByDomain(domain.name);
        for (const tool of tools) {
          const impl = bridge.implementations.get(tool.name);
          if (impl) {
            this.implementations.set(`${domain.name}.${tool.name}`, impl);
          }
        }
      } else if (domain.adapter === 'markdown') {
        // Markdown tools return their stored content directly
        const tools = this.registry.getToolsByDomain(domain.name);
        for (const tool of tools) {
          const content = tool.examples?.[0] ?? '';
          this.implementations.set(
            `${domain.name}.${tool.name}`,
            async () => content
          );
        }
      }
    }
  }

  private buildInstructions(): string {
    const cap = this.buildCapabilitySummary();
    const desc = this.config.description ?? '';
    const lines = [
      `codemode-x provides cmx_search and cmx_execute tools for the "${this.config.sdkName}" SDK.`,
      `Available: ${cap}.`,
    ];
    if (desc) lines.push(desc);
    lines.push(
      `Use cmx_execute for data queries, API calls, and analysis — it already knows the schema, auth, and connections.`,
      `Use cmx_search first to discover method signatures if unsure what's available.`,
    );
    return lines.join(' ');
  }

  private buildCapabilitySummary(): string {
    const parts: string[] = [];
    for (const domainName of this.registry.domains) {
      const tools = this.registry.getToolsByDomain(domainName);
      const names = tools.slice(0, 8).map(t => t.name.replace(/^(get|list|fetch)/, '').replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '')).join(', ');
      const suffix = tools.length > 8 ? `, +${tools.length - 8} more` : '';
      parts.push(`${domainName} (${tools.length} tools — ${names}${suffix})`);
    }
    return parts.join('; ');
  }

  private registerTools(): void {
    const cap = this.buildCapabilitySummary();
    const desc = this.config.description ? ` ${this.config.description}` : '';

    this.server.registerTool(
      'cmx_search',
      {
        description: `Search ${this.config.sdkName} APIs and docs. Returns matching tool signatures + TypeScript types. Use this FIRST to discover available methods before writing cmx_execute code. Domains: ${cap}.${desc}`,
        inputSchema: z.object({
          query: z.string().describe('Natural language or keyword search (e.g., "properties", "rent data", "comps")'),
        }),
      },
      async ({ query }) => this.handleSearch(query),
    );

    this.server.registerTool(
      'cmx_execute',
      {
        description: `Execute TypeScript code against the ${this.config.sdkName} SDK. Use sdk.<domain>.<method>(params) to call APIs. Code runs in a sandbox. USE THIS for any data question — it already knows the schema, auth, and connections. Domains: ${cap}.${desc}`,
        inputSchema: z.object({
          code: z.string().describe('TypeScript code using sdk.<domain>.<method>(). Must use await for async calls.'),
        }),
      },
      async ({ code }) => this.handleExecute(code),
    );
  }

  private async handleSearch(query: string) {
    if (!query?.trim()) {
      return {
        content: [{ type: 'text' as const, text: 'Please provide a search query.' }],
        isError: true,
      };
    }

    const results = this.searchIndex.search(query);
    const formatted = formatSearchResults(this.config.sdkName, results);

    return {
      content: [{ type: 'text' as const, text: formatted }],
    };
  }

  private async handleExecute(code: string) {
    if (!code?.trim()) {
      return {
        content: [{ type: 'text' as const, text: 'Please provide code to execute.' }],
        isError: true,
      };
    }

    // Build proxy with current implementations
    this.callLog = [];
    const proxy = buildSdkProxy(
      this.registry,
      this.implementations,
      this.credentials,
      this.callLog
    );
    const flatFns = flattenProxy(proxy);

    const result = await this.executor.execute(code, flatFns, {
      timeout: this.config.executor?.timeout ?? 30_000,
      memoryMB: this.config.executor?.memoryMB ?? 128,
    });

    const output: string[] = [];

    if (result.logs.length > 0) {
      output.push('--- Logs ---');
      output.push(...result.logs);
    }

    if (result.success) {
      if (result.result !== undefined) {
        output.push('--- Result ---');
        output.push(typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2));
      }
    } else {
      output.push('--- Error ---');
      output.push(result.error ?? 'Unknown error');
    }

    output.push(`\n(${result.durationMs}ms, ${this.callLog.length} API calls)`);

    return {
      content: [{ type: 'text' as const, text: output.join('\n') }],
      isError: !result.success,
    };
  }

  async start(): Promise<void> {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Initialization timed out after 30s')), 30_000)
    );
    await Promise.race([this.initialize(), timeout]);

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('[cmx] Server started on stdio');
  }
}

/** Build an HTTP-based tool implementation for Express routes */
function buildHttpImplementation(
  tool: ToolDefinition,
  baseUrl: string,
  auth?: HeaderAuthConfig
): ToolImplementation {
  return async (params: Record<string, unknown>) => {
    let url = `${baseUrl}${tool.route}`;
    const method = tool.method ?? 'GET';

    // Substitute route params
    const routeParams = (tool.route?.match(/:(\w+)/g) || []).map(p => p.slice(1));
    for (const rp of routeParams) {
      if (params[rp] !== undefined) {
        url = url.replace(`:${rp}`, String(params[rp]));
      }
    }

    // Build query string for GET requests
    if (method === 'GET') {
      const queryParams = Object.entries(params)
        .filter(([k]) => !routeParams.includes(k))
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
      if (queryParams) url += `?${queryParams}`;
    }

    // Build body for non-GET
    const bodyParams: Record<string, unknown> = {};
    if (method !== 'GET' && method !== 'DELETE') {
      for (const [k, v] of Object.entries(params)) {
        if (!routeParams.includes(k)) {
          bodyParams[k] = v;
        }
      }
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    // Inject auth header from environment variable at request time
    if (auth) {
      const value = process.env[auth.envVar];
      if (value) {
        headers[auth.key] = value;
      }
    }

    const fetchOpts: RequestInit = {
      method,
      headers,
    };

    if (method !== 'GET' && method !== 'DELETE' && Object.keys(bodyParams).length > 0) {
      fetchOpts.body = JSON.stringify(bodyParams);
    }

    const response = await fetch(url, fetchOpts);
    const contentType = response.headers.get('content-type') ?? '';

    if (contentType.includes('application/json')) {
      return response.json();
    }
    return response.text();
  };
}

/** Load config from a file path.
 *  Supports .js, .mjs, and .json configs. For .ts, users need tsx or ts-node.
 */
export async function loadConfig(configPath?: string): Promise<CmxConfig> {
  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const searchPaths = configPath
    ? [resolve(configPath)]
    : [
        resolve(projectDir, 'codemode-x.config.js'),
        resolve(projectDir, 'codemode-x.config.mjs'),
        resolve(projectDir, 'codemode-x.config.json'),
        resolve(process.cwd(), 'codemode-x.config.js'),
        resolve(process.cwd(), 'codemode-x.config.mjs'),
        resolve(process.cwd(), 'codemode-x.config.json'),
      ];

  for (const p of [...new Set(searchPaths)]) {
    if (existsSync(p)) {
      if (p.endsWith('.json')) {
        const raw = (await import('fs')).readFileSync(p, 'utf-8');
        return JSON.parse(raw) as CmxConfig;
      }
      // Use file:// URL for cross-platform import compatibility
      const fileUrl = new URL(`file://${p}`);
      const mod = await import(fileUrl.href);
      return mod.default ?? mod;
    }
  }

  throw new Error(
    `No codemode-x config found. Create one with: npx codemode-x init\n` +
    `Searched:\n  ${[...new Set(searchPaths)].join('\n  ')}`
  );
}

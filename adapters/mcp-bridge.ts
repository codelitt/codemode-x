import type { Adapter, ToolDefinition, AdapterOptions, ParameterDef } from '../src/types.js';

/**
 * MCP Bridge adapter — connects to an existing MCP server and wraps
 * its tools as codemode-x ToolDefinitions.
 *
 * Source: command string to start the MCP server (e.g., "node my-server.js")
 *         or a JSON config: { command: string, args?: string[], env?: Record<string, string> }
 *
 * Options (via DomainConfig.options):
 *   - tools: string[]     — only include these tools
 *   - exclude: string[]   — exclude these tools
 *
 * This bridges existing MCP servers into codemode-x's 2-tool architecture,
 * letting Claude discover and call them via cmx_search + cmx_execute.
 */
export const mcpBridgeAdapter: Adapter = {
  name: 'mcp-bridge',

  async parse(source: unknown, opts?: AdapterOptions): Promise<ToolDefinition[]> {
    const domain = opts?.domain ?? 'mcp';
    const options = (opts as any) ?? {};
    const includeTools: string[] | undefined = options.tools;
    const excludeTools: string[] | undefined = options.exclude;

    // Parse source — either a command string or config object
    const serverConfig = parseServerConfig(source);

    // Connect to the MCP server and list its tools
    const mcpTools = await listMcpTools(serverConfig);

    const tools: ToolDefinition[] = [];

    for (const mcpTool of mcpTools) {
      // Apply include/exclude filters
      if (includeTools && !includeTools.includes(mcpTool.name)) continue;
      if (excludeTools && excludeTools.includes(mcpTool.name)) continue;

      const parameters = extractParameters(mcpTool.inputSchema);

      tools.push({
        name: mcpTool.name,
        domain,
        description: mcpTool.description ?? `MCP tool: ${mcpTool.name}`,
        parameters,
        returnType: 'unknown',
        readOnly: inferReadOnly(mcpTool.name),
        transport: 'mcp',
        method: 'CALL',
        route: mcpTool.name, // Store original tool name for invocation
      });
    }

    return tools;
  },
};

// ─── Server Config ───────────────────────────────────────────────

interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export function parseServerConfig(source: unknown): McpServerConfig {
  if (typeof source === 'string') {
    // Simple command string: "node my-server.js" or "python -m my_server"
    const parts = source.split(/\s+/);
    return { command: parts[0], args: parts.slice(1) };
  }

  if (typeof source === 'object' && source !== null) {
    const config = source as any;
    if (!config.command) {
      throw new Error('MCP bridge source must have a "command" field');
    }
    return {
      command: config.command,
      args: config.args ?? [],
      env: config.env,
    };
  }

  throw new Error(
    'MCP bridge source must be a command string (e.g., "node server.js") ' +
    'or an object with { command, args?, env? }'
  );
}

// ─── MCP Client ──────────────────────────────────────────────────

interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/**
 * Connect to an MCP server via stdio transport, list its tools, then disconnect.
 */
async function listMcpTools(config: McpServerConfig): Promise<McpToolInfo[]> {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');

  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: config.env ? { ...process.env, ...config.env } as Record<string, string> : undefined,
  });

  const client = new Client(
    { name: 'codemode-x-bridge', version: '0.1.0' },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);
    const response = await client.listTools();
    return (response.tools ?? []).map((t: any) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  } finally {
    try { await client.close(); } catch {}
  }
}

/**
 * Build a function that calls a tool on a remote MCP server.
 * Maintains a persistent connection for the lifetime of the server.
 */
export async function buildMcpBridgeInvoker(
  source: unknown,
): Promise<{
  implementations: Map<string, (args: Record<string, unknown>) => Promise<unknown>>;
  close: () => Promise<void>;
}> {
  const config = parseServerConfig(source);

  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');

  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: config.env ? { ...process.env, ...config.env } as Record<string, string> : undefined,
  });

  const client = new Client(
    { name: 'codemode-x-bridge', version: '0.1.0' },
    { capabilities: {} }
  );

  await client.connect(transport);

  // Get all tools and build implementations
  const response = await client.listTools();
  const implementations = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();

  for (const tool of response.tools ?? []) {
    implementations.set(tool.name, async (args: Record<string, unknown>) => {
      const result = await client.callTool({ name: tool.name, arguments: args });

      // Extract text content from MCP response
      const contents = (result.content ?? []) as any[];
      if (contents.length === 1 && contents[0].type === 'text') {
        try {
          return JSON.parse(contents[0].text);
        } catch {
          return contents[0].text;
        }
      }
      return contents.map((c: any) => c.text ?? c).join('\n');
    });
  }

  return {
    implementations,
    close: async () => { try { await client.close(); } catch {} },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Extract ParameterDef[] from an MCP tool's JSON Schema inputSchema.
 */
export function extractParameters(inputSchema?: Record<string, unknown>): ParameterDef[] {
  if (!inputSchema) return [];

  const properties = (inputSchema.properties ?? {}) as Record<string, any>;
  const required = new Set((inputSchema.required ?? []) as string[]);

  return Object.entries(properties).map(([name, schema]) => ({
    name,
    type: mapJsonSchemaType(schema),
    required: required.has(name),
    description: schema.description,
    default: schema.default,
  }));
}

/** Map JSON Schema types to TypeScript type strings */
export function mapJsonSchemaType(schema: any): string {
  if (!schema || !schema.type) return 'unknown';

  const typeMap: Record<string, string> = {
    string: 'string',
    number: 'number',
    integer: 'number',
    boolean: 'boolean',
    null: 'null',
  };

  if (typeMap[schema.type]) return typeMap[schema.type];

  if (schema.type === 'array') {
    const items = schema.items ? mapJsonSchemaType(schema.items) : 'unknown';
    return `${items}[]`;
  }

  if (schema.type === 'object') {
    if (schema.properties) {
      const props = Object.entries(schema.properties as Record<string, any>)
        .map(([k, v]) => `${k}: ${mapJsonSchemaType(v)}`)
        .join('; ');
      return `{ ${props} }`;
    }
    return 'Record<string, unknown>';
  }

  return 'unknown';
}

/** Infer read-only from tool name */
export function inferReadOnly(name: string): boolean {
  const lower = name.toLowerCase();
  const writePatterns = ['create', 'update', 'delete', 'write', 'send', 'post', 'put', 'save', 'remove', 'insert', 'modify', 'set'];
  for (const p of writePatterns) {
    if (lower.includes(p)) return false;
  }
  return true;
}

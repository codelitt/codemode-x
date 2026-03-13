# MCP Bridge Adapter

Connect existing MCP servers and wrap their tools into codemode-x's 2-tool architecture. Any MCP-compatible server becomes searchable and callable through `cmx_search` and `cmx_execute`.

## Configuration

### Command string

The simplest way — pass the command to start the MCP server:

```js
export default {
  sdkName: 'myapp',
  domains: [
    {
      name: 'github',
      adapter: 'mcp-bridge',
      source: 'node /path/to/github-mcp-server.js',
    },
  ],
};
```

### Config object

For servers that need environment variables or specific arguments:

```js
{
  name: 'slack',
  adapter: 'mcp-bridge',
  source: {
    command: 'node',
    args: ['./mcp-servers/slack/index.js'],
    env: { SLACK_TOKEN: process.env.SLACK_TOKEN },
  },
}
```

## How it works

### Discovery

1. codemode-x spawns the MCP server as a child process (stdio transport)
2. Connects using `@modelcontextprotocol/sdk` Client
3. Calls `listTools()` to discover all available tools
4. Maps each tool's JSON Schema `inputSchema` to typed `ParameterDef[]`
5. Disconnects from the server

### Execution

When Claude calls a bridged tool via `cmx_execute`:

1. codemode-x maintains a persistent MCP client connection
2. Calls `callTool({ name, arguments })` on the remote server
3. Extracts text content from the MCP response
4. Returns parsed JSON (or raw text if not JSON)

## Tool Filtering

```js
// Only expose specific tools
options: { tools: ['search_repos', 'get_file_contents'] }

// Expose everything except these
options: { exclude: ['delete_repo', 'force_push'] }
```

## JSON Schema Type Mapping

MCP tools use JSON Schema for their input parameters. The adapter maps these to TypeScript types:

| JSON Schema | TypeScript |
|-------------|-----------|
| `string` | `string` |
| `number`, `integer` | `number` |
| `boolean` | `boolean` |
| `null` | `null` |
| `array` (with items) | `items_type[]` |
| `object` (with properties) | `{ prop: type; ... }` |
| `object` (no properties) | `Record<string, unknown>` |

## Read-Only Inference

Tools are inferred as read-only unless their name contains write-indicating patterns: `create`, `update`, `delete`, `write`, `send`, `post`, `put`, `save`, `remove`, `insert`, `modify`, `set`.

## Multi-server setup

Bridge multiple MCP servers into a single codemode-x config:

```js
export default {
  sdkName: 'workspace',
  domains: [
    {
      name: 'github',
      adapter: 'mcp-bridge',
      source: 'node ./mcp-servers/github.js',
    },
    {
      name: 'slack',
      adapter: 'mcp-bridge',
      source: 'node ./mcp-servers/slack.js',
      options: { tools: ['send_message', 'search_messages'] },
    },
    {
      name: 'postgres',
      adapter: 'mcp-bridge',
      source: 'node ./mcp-servers/postgres.js',
      options: { exclude: ['drop_table'] },
    },
  ],
};
```

Claude searches across all servers with a single `cmx_search`. A search for "messages" might return Slack's `send_message` tool and the Postgres `messages` table query — all through the same SDK interface.

## Why bridge instead of using MCP directly?

Claude Code already supports MCP servers. The bridge adapter adds value when you have:

- **Many MCP servers** — each one adds N tools to Claude's context. The bridge collapses them all into 2 tools with search.
- **Large tool counts** — an MCP server with 50+ tools consumes significant context. codemode-x only surfaces the relevant ones per query.
- **Mixed sources** — combine MCP servers with Express APIs, databases, Lambda functions, and Python modules in one searchable SDK.

## Requirements

- `@modelcontextprotocol/sdk` (already a dependency of codemode-x)
- The MCP server must support stdio transport
- The server command must be executable from the codemode-x process

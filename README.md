# codemode-x

MCP plugin for Claude Code. Compresses your APIs, databases, Lambda functions, and docs into 2 MCP tools (~1,000 tokens) instead of N tools (100K+ tokens).

Claude writes TypeScript against a typed SDK. Code runs in a sandbox.

Built by [Carbon](https://www.carbonresidential.com/) and [Codelitt](https://www.codelitt.com/).

## How it works

```
cmx_search("users orders")                                     →  typed SDK signatures for matching tools
cmx_execute("await sdk.api.getUsers()")                         →  real API call, sandboxed
cmx_execute("await sdk.data.rawQuery({ sql: 'SELECT ...' })")  →  database query, read-only
```

Two tools:

1. `cmx_search(query)` — FTS5 full-text search across all your APIs, database tables, and docs. Returns typed SDK signatures for matches only.
2. `cmx_execute(code)` — runs TypeScript in a VM sandbox using `sdk.<domain>.<method>()`. AST-validated. Credentials injected at runtime, never in context.

This is not RAG. The search index holds function signatures, not data. `sdk.api.getUsers()` makes a real HTTP request to your running server. `sdk.data.rawQuery({ sql: '...' })` hits your actual database. The compression is about discovery — Claude finds the right endpoint in ~500 tokens instead of loading every tool definition into context.

### Why not just use a bigger context window?

Every MCP tool you register costs tokens on every request, even if Claude only uses one. 25 endpoints = ~100K tokens of tool schemas before Claude writes a single line of code. codemode-x makes that ~1K tokens.

Same reason databases have indexes even when you have plenty of RAM.

## Maturity

Developers at [Codelitt](https://www.codelitt.com/) dogfood codemode-x at [Carbon](https://www.carbonresidential.com/) for real estate operations. Express, OpenAPI, and Database adapters run against production APIs and data daily. Markdown, Lambda (manifest mode), Python, and MCP Bridge have test coverage but less mileage. Lambda AWS discovery is beta.

## Quick start

```bash
cd your-project
npm install codemode-x

# Interactive setup — detects Express/OpenAPI files, generates config
npx codemode-x init

# Or create a config manually
cat > codemode-x.config.js << 'EOF'
export default {
  sdkName: 'myapp',
  domains: [
    {
      name: 'api',
      adapter: 'express',
      source: './server.js',
      baseUrl: 'http://localhost:3000',
      auth: { scope: 'readwrite' },
      // Or use header-based auth with an env var:
      // auth: { type: 'header', key: 'X-API-Key', envVar: 'MY_API_KEY' },
    },
  ],
};
EOF

# Test your config
npx codemode-x test

# Start as MCP server
npx codemode-x start
```

### Install

**Option 1: Claude Code marketplace**

```bash
/install codemode-x
```

Installs as a Claude Code plugin with automatic updates. Then run `npx codemode-x init` in your project to generate a config.

If codemode-x isn't in your marketplace yet:

```bash
/plugin marketplace add codelitt/codemode-x
/plugin install codemode-x@codemode-x
```

**Option 2: npm**

```bash
npm install -g codemode-x
cd your-project
npx codemode-x init    # generates codemode-x.config.js + .mcp.json
```

Restart Claude Code. `cmx_search` and `cmx_execute` appear automatically.

**Option 3: Manual `.mcp.json`**

Create `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "codemode-x": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "codemode-x", "start"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

Add `.mcp.json` to `.gitignore` if it contains secrets.

## Adapters

Each adapter introspects a source (API code, spec file, database, etc.) and generates typed SDK methods.

| Adapter | Source | What it does | Status |
|---------|--------|--------------|--------|
| [`express`](#express) | Express.js app file | Parses route handlers via AST | Production |
| [`openapi`](#openapi) | OpenAPI 3.x spec (JSON) | Extracts operations + schemas | Production |
| [`database`](#database) | SQLite database file | Introspects schema, generates query tools | Production |
| [`markdown`](#markdown) | Markdown files/globs | Indexes docs as searchable content | Stable |
| [`lambda`](#lambda-functions) | AWS Lambda functions | Manifest file or AWS discovery | Manifest: Stable, AWS discovery: Beta |
| [`python`](#python) | Python modules | Introspects functions via subprocess | Stable |
| [`mcp-bridge`](#mcp-bridge) | Existing MCP servers | Bridges MCP tools into codemode-x | Stable |

*Production* = dogfooded in real workloads. *Stable* = implemented with test coverage, not yet production. *Beta* = functional but limited testing.

---

### Express

Parses Express.js source via AST. Extracts `app.get()`, `app.post()`, etc. and generates typed SDK methods.

```js
export default {
  sdkName: 'myapp',
  domains: [
    {
      name: 'api',
      adapter: 'express',
      source: './server.js',
      baseUrl: 'http://localhost:3000',
      auth: { scope: 'readwrite' },
    },
  ],
};
```

Claude sees `sdk.api.getProperties()`, `sdk.api.createUser({ name, email })`. Calls go via HTTP to your running server.

### OpenAPI

Parses OpenAPI 3.x / Swagger JSON specs. Extracts operations with parameters, request bodies, and response schemas.

```js
export default {
  sdkName: 'myapp',
  domains: [
    {
      name: 'api',
      adapter: 'openapi',
      source: './openapi.json',
      baseUrl: 'https://api.example.com',
    },
  ],
};
```

Path params, query params, and request body properties become typed method parameters. Response schemas become TypeScript types.

### Markdown

Splits markdown files by heading into searchable sections.

```js
export default {
  sdkName: 'myapp',
  domains: [
    {
      name: 'docs',
      adapter: 'markdown',
      source: './docs/**/*.md',
    },
  ],
};
```

Single files or globs. Claude finds relevant doc sections alongside API methods when searching.

### Lambda functions

Two modes:

**Manifest mode** — you define a JSON file with function names and schemas:

```js
export default {
  sdkName: 'platform',
  domains: [
    { name: 'payments', adapter: 'lambda', source: './manifests/payments.json' },
    { name: 'users', adapter: 'lambda', source: './manifests/users.json' },
  ],
};
```

**AWS discovery mode** — scans your account, reads schemas from function tags:

```js
export default {
  sdkName: 'platform',
  domains: [
    {
      name: 'api',
      adapter: 'lambda',
      source: 'us-east-1',
      options: {
        prefix: 'myapp-',              // only functions starting with this
        tags: { team: 'payments' },     // only functions with these tags
      },
    },
  ],
};
```

Invocation via `Lambda.invoke()`, not HTTP. Credentials from your environment.

Manifest mode is fully tested. AWS discovery mode is beta — works but hasn't been used in production.

Full guide: [docs/lambda-adapter.md](docs/lambda-adapter.md)

### Database

Introspects a SQLite database schema and generates query tools. Read-only by default.

```js
export default {
  sdkName: 'myapp',
  domains: [
    {
      name: 'data',
      adapter: 'database',
      source: './app.db',
      options: {
        tables: ['users', 'orders'],    // optional: only these tables
        // exclude: ['migrations'],      // or: exclude these tables
      },
    },
  ],
};
```

Per-table `query{TableName}` tools with columns as optional filters:

```typescript
await sdk.data.queryUsers()                     // SELECT * FROM users
await sdk.data.queryUsers({ name: 'Alice' })    // WHERE name = 'Alice'
await sdk.data.queryUsers({ age: 30 })          // WHERE age = 30
```

Plus a `rawQuery` tool for arbitrary read-only SQL:

```typescript
await sdk.data.rawQuery({
  sql: 'SELECT u.name, COUNT(o.id) as order_count FROM users u JOIN orders o ON u.id = o.user_id GROUP BY u.name'
})
```

SQL validation:
- Allowed: `SELECT`, `PRAGMA`, `EXPLAIN`
- Blocked: `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `CREATE`
- Multi-statement queries rejected

Column types map automatically: `INTEGER` → `number`, `TEXT`/`VARCHAR` → `string`, `REAL` → `number`, `BOOLEAN` → `boolean`.

Full guide: [docs/database-adapter.md](docs/database-adapter.md)

### Python

Introspects Python modules via subprocess. Extracts function signatures, type hints, and docstrings. Each public function becomes an SDK method.

```js
export default {
  sdkName: 'myapp',
  domains: [
    {
      name: 'analytics',
      adapter: 'python',
      source: './lib/analytics.py',
      options: {
        python: 'python3',              // optional: path to interpreter
        functions: ['run_report'],       // optional: only include these
        // exclude: ['helper_fn'],       // or: exclude these
      },
    },
  ],
};
```

Given:

```python
def get_user_stats(user_id: str, days: int = 30) -> Dict[str, float]:
    """Get usage statistics for a user over a time period."""
    ...
```

Claude sees: `sdk.analytics.getUserStats({ user_id: string, days?: number }) → Record<string, number>`

Type hints map: `str` → `string`, `int`/`float` → `number`, `bool` → `boolean`, `List[X]` → `X[]`, `Optional[X]` → `X | null`.

Functions run via subprocess. Python gets its own process with params as JSON. No shared memory, no import conflicts.

Full guide: [docs/python-adapter.md](docs/python-adapter.md)

### MCP Bridge

Wraps an existing MCP server's tools as codemode-x SDK methods.

```js
export default {
  sdkName: 'myapp',
  domains: [
    {
      name: 'github',
      adapter: 'mcp-bridge',
      source: 'node /path/to/github-mcp-server.js',
      options: {
        tools: ['search_repos', 'get_file'],  // optional: only include these
        // exclude: ['delete_repo'],            // or: exclude these
      },
    },
  ],
};
```

Source can be a command string or config object:

```js
// Command string
source: 'python -m my_mcp_server'

// Config object (for env vars, custom args)
source: {
  command: 'node',
  args: ['./mcp-server/index.js', '--port', '3000'],
  env: { API_KEY: 'xxx' },
}
```

Connects via stdio, discovers tools via `listTools()`, maps JSON Schema parameters to typed SDK methods. At runtime, `cmx_execute` proxies calls through the MCP client.

Any MCP server — GitHub, Slack, Postgres, whatever — gets collapsed into the 2-tool interface with search across all of them.

Full guide: [docs/mcp-bridge-adapter.md](docs/mcp-bridge-adapter.md)

## Memory database

Pair with [memory-x](https://github.com/codelitt/memory-x) for queryable, persistent memory backed by SQLite. memory-x turns markdown files into structured tables — dynamically infers schema from your content.

### Setup

```bash
npm install -g memory-x

memoryx init
memoryx import ./CLAUDE.md
memoryx import ./docs/
memoryx status
```

### Using with codemode-x

Add the memory database as a domain:

```js
export default {
  sdkName: 'myapp',
  domains: [
    {
      name: 'memory',
      adapter: 'database',
      source: './memory.db',
      options: { writable: true },  // Claude can write live context
    },
    {
      name: 'api',
      adapter: 'express',
      source: './server.js',
      baseUrl: 'http://localhost:3000',
    },
  ],
};
```

Claude can query context alongside APIs:

```typescript
await sdk.memory.queryPeople({ who: 'Alice' })
await sdk.memory.queryTerms({ term: 'SLA' })
await sdk.memory.rawQuery({ sql: "SELECT * FROM people WHERE role LIKE '%Lead%'" })
await sdk.api.getUsers()
```

Full guide: [docs/memory-database.md](docs/memory-database.md)

## Multi-domain configs

Combine adapters in one config. `cmx_search` searches across all of them:

```js
export default {
  sdkName: 'myapp',
  domains: [
    { name: 'api',      adapter: 'express',  source: './server.js', baseUrl: 'http://localhost:3000', auth: { scope: 'readwrite' } },
    { name: 'payments', adapter: 'lambda',   source: './manifests/payments.json' },
    { name: 'data',     adapter: 'database', source: './app.db' },
    { name: 'memory',   adapter: 'database', source: './memory.db' },
    { name: 'docs',     adapter: 'markdown', source: './docs/**/*.md' },
  ],
};
```

Search for "users" returns API endpoints, database tables, and doc sections — all typed, all callable through `sdk.*`.

### How we use it at Carbon

We run this at [Carbon](https://www.carbonresidential.com/) for real estate operations. Express and OpenAPI adapters hit our rent comps API and property management system in production. Database and markdown adapters handle portfolio context and ops docs.

```js
export default {
  sdkName: 'carbon',
  domains: [
    { name: 'rentComps', adapter: 'express', source: './server.js', baseUrl: 'http://localhost:3001' },
    { name: 'portfolio', adapter: 'database', source: './properties.db' },
    { name: 'memory', adapter: 'database', source: './memory.db' },
    { name: 'docs', adapter: 'markdown', source: './docs/**/*.md' },
  ],
};
```

"rent comps for Maple Ridge" returns the API endpoint, the property record, and the relevant docs. Still 2 MCP tools.

## Architecture

```
User query → cmx_search → FTS5/BM25 index → typed SDK signatures (~500 tokens)
                                ↓
User code  → cmx_execute → AST validation → VM sandbox → sdk.domain.method()
                                                              ↓
                                              HTTP / Lambda.invoke() / SQLite / Python subprocess / MCP proxy
```

### Security

- AST validation blocks `require`, `import`, `fetch`, `process`, `eval`, `Function`
- VM sandbox via `vm.createContext` — no Node globals exposed
- Credentials injected at execution time only, never in LLM context
- Header auth: `auth: { type: 'header', key: 'X-API-Key', envVar: 'MY_API_KEY' }` injects from env vars at request time
- Read-only by default — writes require explicit `auth: { scope: 'readwrite' }`
- Database read-only by default — writable opt-in via `options: { writable: true }`
- SQL validation rejects write statements and multi-statement queries in read-only mode

## CLI

```bash
npx codemode-x init     # interactive setup
npx codemode-x test     # discover tools, show what Claude sees
npx codemode-x start    # start MCP server (stdio)
```

## Development

```bash
npm install
npm run build
npm test

npm run test:watch       # watch mode
npm run test:live        # e2e against running server
```

## Docs

- [Lambda adapter](docs/lambda-adapter.md) — manifest format, AWS discovery, tagging, filtering
- [Database adapter](docs/database-adapter.md) — SQL validation, type mapping, table filtering
- [Python adapter](docs/python-adapter.md) — type mapping, subprocess execution, docstring parsing
- [MCP Bridge adapter](docs/mcp-bridge-adapter.md) — connecting MCP servers, JSON Schema mapping
- [Memory database](docs/memory-database.md) — using [memory-x](https://github.com/codelitt/memory-x) with codemode-x

## License

MIT

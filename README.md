# codemode-x

MCP plugin for Claude Code. Takes your APIs, databases, Lambda functions, and docs and compresses them into 2 MCP tools (~1,000 tokens) instead of N tools (100K+ tokens).

Claude writes TypeScript against a typed SDK. Code runs in a sandbox.

Built by [Carbon](https://www.carbonresidential.com/) and [Codelitt](https://www.codelitt.com/).

## How it works

```
cmx_search("users orders")                                     →  typed SDK signatures for matching tools
cmx_execute("await sdk.api.getUsers()")                         →  real API call, sandboxed
cmx_execute("await sdk.data.rawQuery({ sql: 'SELECT ...' })")  →  database query, read-only
```

Two tools handle everything:

1. **`cmx_search(query)`** — find available APIs, database tables, and docs via FTS5 full-text search. Returns matching tool signatures and TS types for only the matched tools.
2. **`cmx_execute(code)`** — run TypeScript using `sdk.<domain>.<method>()`. AST-validated, sandboxed, credentials injected at runtime.

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

**Option 1: Claude Code marketplace (recommended)**

```bash
/install codemode-x
```

This installs codemode-x as a Claude Code plugin with automatic updates. After installing, run `npx codemode-x init` in your project to generate a config.

If codemode-x isn't in your marketplace yet, add it first:

```bash
/plugin marketplace add codelitt/codemode-x
/plugin install codemode-x@codemode-x
```

**Option 2: npm (per-project)**

```bash
npm install -g codemode-x
cd your-project
npx codemode-x init    # generates codemode-x.config.js + .mcp.json
```

Restart Claude Code. The `cmx_search` and `cmx_execute` tools appear automatically.

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

> **Note:** Add `.mcp.json` to your `.gitignore` if it contains env vars with secrets.

## Adapters

codemode-x uses adapters to understand different data sources. Each adapter introspects a source (API code, spec file, database, etc.) and generates typed SDK methods that Claude can search and call.

| Adapter | Source | What it does | Status |
|---------|--------|--------------|--------|
| [`express`](#express) | Express.js app file | Parses route handlers via AST | Done |
| [`openapi`](#openapi) | OpenAPI 3.x spec (JSON) | Extracts operations + schemas | Done |
| [`markdown`](#markdown) | Markdown files/globs | Indexes docs as searchable content | Done |
| [`lambda`](#lambda-functions) | AWS Lambda functions | Manifest file or AWS discovery | Done |
| [`database`](#database) | SQLite database file | Introspects schema, generates query tools | Done |
| [`python`](#python) | Python modules | Introspects functions via subprocess | Done |
| [`mcp-bridge`](#mcp-bridge) | Existing MCP servers | Bridges MCP tools into codemode-x | Done |

---

### Express

Parses your Express.js source code using AST analysis. Extracts all `app.get()`, `app.post()`, etc. routes and generates typed SDK methods.

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

Claude sees methods like `sdk.api.getProperties()`, `sdk.api.createUser({ name, email })`. Calls are made via HTTP to your running server.

### OpenAPI

Parses OpenAPI 3.x / Swagger JSON specs. Extracts all operations with their parameters, request bodies, and response schemas.

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

Path parameters, query parameters, and request body properties all become typed method parameters. Response schemas are converted to TypeScript types.

### Markdown

Indexes markdown documentation as searchable content. Splits files by headings into sections, each becoming a searchable tool.

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

Supports single files or glob patterns. When Claude searches, it finds relevant doc sections alongside API methods.

### Lambda functions

Turns AWS Lambda functions into SDK methods. Two modes:

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

Invocation happens via `Lambda.invoke()`, not HTTP. Credentials come from your environment. Supports 1000+ functions — Claude still sees just 2 MCP tools and searches across all of them.

Full guide: [docs/lambda-adapter.md](docs/lambda-adapter.md)

### Database

Introspects a SQLite database schema and generates query tools automatically. The database is always opened **read-only**.

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

For each table, the adapter generates a `query{TableName}` tool with all columns as optional filter parameters:

```typescript
// Claude can write:
await sdk.data.queryUsers()                     // SELECT * FROM users
await sdk.data.queryUsers({ name: 'Alice' })    // WHERE name = 'Alice'
await sdk.data.queryUsers({ age: 30 })          // WHERE age = 30
```

It also generates a `rawQuery` tool for arbitrary read-only SQL:

```typescript
await sdk.data.rawQuery({
  sql: 'SELECT u.name, COUNT(o.id) as order_count FROM users u JOIN orders o ON u.id = o.user_id GROUP BY u.name'
})
```

**SQL validation** enforces read-only access:
- Allowed: `SELECT`, `PRAGMA`, `EXPLAIN`
- Blocked: `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `CREATE`
- Multi-statement queries are rejected

Column types are mapped automatically: `INTEGER` → `number`, `TEXT`/`VARCHAR` → `string`, `REAL` → `number`, `BOOLEAN` → `boolean`.

Full guide: [docs/database-adapter.md](docs/database-adapter.md)

### Python

Introspects Python modules via subprocess to extract function signatures, type hints, and docstrings. Each public function becomes an SDK method.

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

Given a Python function:

```python
def get_user_stats(user_id: str, days: int = 30) -> Dict[str, float]:
    """Get usage statistics for a user over a time period."""
    ...
```

Claude sees: `sdk.analytics.getUserStats({ user_id: string, days?: number }) → Record<string, number>`

Python type hints map automatically: `str` → `string`, `int`/`float` → `number`, `bool` → `boolean`, `List[X]` → `X[]`, `Optional[X]` → `X | null`.

Functions are called via subprocess — Python runs in its own process with params as JSON. No shared memory, no import conflicts.

Full guide: [docs/python-adapter.md](docs/python-adapter.md)

### MCP Bridge

Connects to an existing MCP server and wraps its tools as codemode-x SDK methods. This bridges any MCP-compatible tool server into the 2-tool architecture.

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

The source can be a command string or a config object:

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

codemode-x connects via stdio transport, discovers all tools via `listTools()`, and maps their JSON Schema parameters to typed SDK methods. At runtime, `cmx_execute` proxies calls through the MCP client.

This means you can take any existing MCP server — GitHub, Slack, Postgres, custom internal tools — and collapse them all into Claude's 2-tool interface with full search across all of them.

Full guide: [docs/mcp-bridge-adapter.md](docs/mcp-bridge-adapter.md)

## Memory database

Pair codemode-x with [memory-x](https://github.com/codelitt/memory-x) to give Claude queryable, persistent memory backed by SQLite. memory-x turns any markdown files into structured tables — no hardcoded schemas, it dynamically infers structure from your content.

### Setup

```bash
# Install memory-x
npm install -g memory-x

# Create and populate a memory database
memoryx init
memoryx import ./CLAUDE.md
memoryx import ./docs/

# Check what was created
memoryx status
```

### Using it with codemode-x

Add the memory database as a domain in your config:

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

Now Claude can query your context alongside your APIs:

```typescript
// Who's on the team?
await sdk.memory.queryPeople({ who: 'Alice' })

// What does "SLA" mean?
await sdk.memory.queryTerms({ term: 'SLA' })

// Free-form search
await sdk.memory.rawQuery({ sql: "SELECT * FROM people WHERE role LIKE '%Lead%'" })

// And still call your APIs
await sdk.api.getUsers()
```

Full guide: [docs/memory-database.md](docs/memory-database.md)

## Multi-domain configs

The real power is combining multiple adapters in one config. Claude searches across all of them with a single `cmx_search` call:

```js
export default {
  sdkName: 'myapp',
  domains: [
    // REST API
    {
      name: 'api',
      adapter: 'express',
      source: './server.js',
      baseUrl: 'http://localhost:3000',
      auth: { scope: 'readwrite' },
    },
    // Serverless functions
    {
      name: 'payments',
      adapter: 'lambda',
      source: './manifests/payments.json',
    },
    // Application database
    {
      name: 'data',
      adapter: 'database',
      source: './app.db',
    },
    // Project context
    {
      name: 'memory',
      adapter: 'database',
      source: './memory.db',
    },
    // Documentation
    {
      name: 'docs',
      adapter: 'markdown',
      source: './docs/**/*.md',
    },
  ],
};
```

A search for "users" might return results from the API (endpoints), the database (tables), and the docs (relevant sections) — all typed, all callable through the same `sdk.*` interface.

### Real-world example: Carbon

We use this internally at [Carbon](https://www.carbonresidential.com/) for real estate operations. One config connects a rent comps API, property database, investor context, and operational docs:

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

Claude can search across all domains — "rent comps for Maple Ridge" returns the API endpoint, the property record, and the relevant documentation. Still just 2 MCP tools.

## Architecture

```
User query → cmx_search → FTS5/BM25 index → typed SDK signatures (~500 tokens)
                                ↓
User code  → cmx_execute → AST validation → VM sandbox → sdk.domain.method()
                                                              ↓
                                              HTTP / Lambda.invoke() / SQLite / Python subprocess / MCP proxy
```

### Security

- **AST validation** blocks `require`, `import`, `fetch`, `process`, `eval`, and `Function`
- **VM sandbox** via `vm.createContext` with no Node globals exposed
- **Credentials injected** at execution time only, never visible in LLM context
- **Header auth** — use `auth: { type: 'header', key: 'X-API-Key', envVar: 'MY_API_KEY' }` to inject auth headers from environment variables at request time
- **Read-only by default** — write operations require explicit `auth: { scope: 'readwrite' }`
- **Database access** is read-only by default — writable mode is opt-in via `options: { writable: true }`
- **SQL validation** rejects all write statements and multi-statement queries in read-only mode

## CLI

```bash
# Interactive setup — detects Express/OpenAPI files, generates config
npx codemode-x init

# Test config — discovers tools and shows what Claude will see
npx codemode-x test

# Start as MCP server (stdio transport)
npx codemode-x start

# Memory database — use memory-x (https://github.com/codelitt/memory-x)
memoryx init && memoryx import ./CLAUDE.md
```

## Development

```bash
npm install
npm run build
npm test

# Watch mode
npm run test:watch

# Test against a live server (start your API first)
npm run test:live
```

## Docs

- [Lambda Adapter](docs/lambda-adapter.md) — manifest format, AWS discovery, tagging convention, filtering
- [Database Adapter](docs/database-adapter.md) — SQL validation, type mapping, table filtering
- [Python Adapter](docs/python-adapter.md) — type mapping, subprocess execution, docstring parsing
- [MCP Bridge Adapter](docs/mcp-bridge-adapter.md) — connecting existing MCP servers, JSON Schema mapping
- [Memory Database](docs/memory-database.md) — using [memory-x](https://github.com/codelitt/memory-x) with codemode-x

## License

MIT

# codemode-x

MCP plugin for Claude Code. Takes your APIs, databases, Lambda functions, and docs and compresses them into 2 MCP tools (~1,000 tokens) instead of N tools (100K+ tokens).

Claude writes TypeScript against a typed SDK. Code runs in a sandbox.

Built by [Carbon](https://www.carbonresidential.com/) and [Codelitt](https://www.codelitt.com/).

## How it works

```
cmx_search("properties rent data")                          →  typed SDK signatures for matching tools
cmx_execute("await sdk.rentComps.getProperties()")           →  real API call, sandboxed
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
    },
  ],
};
EOF

# Test your config
npx codemode-x test

# Start as MCP server
npx codemode-x start
```

### Adding to Claude Code

```bash
claude mcp add codemode-x -- node /path/to/codemode-x/plugin/start.mjs
```

## Adapters

codemode-x uses adapters to understand different data sources. Each adapter introspects a source (API code, spec file, database, etc.) and generates typed SDK methods that Claude can search and call.

| Adapter | Source | What it does | Status |
|---------|--------|--------------|--------|
| [`express`](#express) | Express.js app file | Parses route handlers via AST | Done |
| [`openapi`](#openapi) | OpenAPI 3.x spec (JSON) | Extracts operations + schemas | Done |
| [`markdown`](#markdown) | Markdown files/globs | Indexes docs as searchable content | Done |
| [`lambda`](#lambda-functions) | AWS Lambda functions | Manifest file or AWS discovery | Done |
| [`database`](#database) | SQLite database file | Introspects schema, generates query tools | Done |
| `python` | Python modules | — | Planned |
| `mcp-bridge` | Existing MCP servers | — | Planned |

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

## Memory database

codemode-x includes a built-in memory system that converts CLAUDE.md-style markdown into a queryable SQLite database. This gives Claude structured access to your project context — team members, properties, terminology, etc.

### Setup

```bash
# Create the database
npx codemode-x memory init

# Import your markdown context
npx codemode-x memory import ./CLAUDE.md

# (Optional) specify a custom db path
npx codemode-x memory init ./data/memory.db
npx codemode-x memory import ./CLAUDE.md ./data/memory.db
```

### Schema

The memory database has 5 tables:

| Table | Purpose | Example data |
|-------|---------|-------------|
| `people` | Team, investors, contacts | name, role, notes, category |
| `properties` | Portfolio / assets | name, type, notes |
| `entities` | Companies, funds, loans | name, description |
| `terms` | Domain terminology | term, meaning |
| `memories` | Generic key-value storage | category, key, value |

### How import works

The importer reads markdown tables and routes them to the right database table based on section headings:

```markdown
## People — Direct Reports & Team
| Who | Role |
|-----|------|
| Alice | Engineering Lead |     → people table (category: 'team')

## People — Investors & External
| Who | Role |
|-----|------|
| Bob | Lead Investor |          → people table (category: 'investor')

## Portfolio — Properties
| Property | Notes |
|----------|-------|
| Sunset Apartments | 48 units | → properties table

## Terms
| Term | Meaning |
|------|---------|
| NOI | Net Operating Income |    → terms table
```

### Using it with the database adapter

Add the memory database as a domain in your config:

```js
export default {
  sdkName: 'carbon',
  domains: [
    {
      name: 'memory',
      adapter: 'database',
      source: './memory.db',
    },
    {
      name: 'api',
      adapter: 'express',
      source: './server.js',
      baseUrl: 'http://localhost:3001',
    },
  ],
};
```

Now Claude can query your context alongside your APIs:

```typescript
// Who's on the team?
await sdk.memory.queryPeople({ category: 'team' })

// What does "NOI" mean?
await sdk.memory.queryTerms({ term: 'NOI' })

// Find properties with specific characteristics
await sdk.memory.rawQuery({ sql: "SELECT * FROM properties WHERE notes LIKE '%renovated%'" })

// And still call your APIs
await sdk.api.getProperties()
```

Full guide: [docs/memory-database.md](docs/memory-database.md)

## Multi-domain configs

The real power is combining multiple adapters in one config. Claude searches across all of them with a single `cmx_search` call:

```js
export default {
  sdkName: 'carbon',
  domains: [
    // REST API
    {
      name: 'rentComps',
      adapter: 'express',
      source: './server.js',
      baseUrl: 'http://localhost:3001',
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

A search for "rent data" might return results from the API (endpoints), the database (tables), and the docs (relevant sections) — all typed, all callable through the same `sdk.*` interface.

## Architecture

```
User query → cmx_search → FTS5/BM25 index → typed SDK signatures (~500 tokens)
                                ↓
User code  → cmx_execute → AST validation → VM sandbox → sdk.domain.method()
                                                              ↓
                                              HTTP fetch / Lambda.invoke() / SQLite query
```

### Security

- **AST validation** blocks `require`, `import`, `fetch`, `process`, `eval`, and `Function`
- **VM sandbox** via `vm.createContext` with no Node globals exposed
- **Credentials injected** at execution time only, never visible in LLM context
- **Read-only by default** — write operations require explicit `auth: { scope: 'readwrite' }`
- **Database access** is always read-only — the file is opened with `readonly: true` and SQL is validated
- **SQL validation** rejects all write statements and multi-statement queries

## CLI

```bash
# Interactive setup — detects Express/OpenAPI files, generates config
npx codemode-x init

# Test config — discovers tools and shows what Claude will see
npx codemode-x test

# Start as MCP server (stdio transport)
npx codemode-x start

# Memory database management
npx codemode-x memory init [db-path]
npx codemode-x memory import <markdown-file> [db-path]
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
- [Memory Database](docs/memory-database.md) — schema, CLI commands, markdown import format

## License

MIT

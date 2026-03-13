# codemode-x

MCP plugin for Claude Code. Takes your APIs, apps, and docs and compresses them into 2 MCP tools (~1,000 tokens) instead of N tools (100K+ tokens).

Claude writes TypeScript against a typed SDK. Code runs in a sandbox.

Built by [Carbon](https://www.carbonresidential.com/) and [Codelitt](https://www.codelitt.com/).

## How it works

```
cmx_search("properties rent data")           →  typed SDK signatures for matching tools
cmx_execute("await sdk.rentComps.getProperties()")  →  real API call, sandboxed
```

Two tools:

1. `cmx_search(query)` -- find available APIs and docs via FTS5 full-text search. Returns matching tool signatures and TS types for only the matched tools.
2. `cmx_execute(code)` -- run TypeScript using `sdk.<domain>.<method>()`. AST-validated, sandboxed, credentials injected at runtime.

## Quick start

```bash
cd your-project
npm install codemode-x

# Create a config pointing at your Express API
cat > codemode-x.config.ts << 'EOF'
import { defineConfig } from 'codemode-x/src/types.js';

export default defineConfig({
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
});
EOF

# Build and run as MCP server
npm run build
node plugin/start.mjs
```

## Example: Carbon rent comps

We use this internally at Carbon for rent comp analysis. One config file turns an Express API into a typed SDK that Claude can search and call:

```typescript
import { defineConfig } from 'codemode-x/src/types.js';

export default defineConfig({
  sdkName: 'carbon',
  domains: [
    {
      name: 'rentComps',
      adapter: 'express',
      source: './server.js',
      baseUrl: 'http://localhost:3001',
      auth: { scope: 'readwrite' },
    },
    {
      name: 'docs',
      adapter: 'markdown',
      source: './docs/**/*.md',
    },
  ],
});
```

Then Claude can do things like:
```typescript
cmx_execute(`
  const props = await sdk.rentComps.getProperties();
  const comps = await sdk.rentComps.getComps({ propertyId: props[0].id });
  const avgRent = comps.reduce((s, c) => s + c.rent, 0) / comps.length;
  return { property: props[0].name, avgCompRent: avgRent };
`)
```

## Adapters

| Adapter | Source | Status |
|---------|--------|--------|
| `express` | Express.js app file | Done |
| `openapi` | OpenAPI 3.x spec (JSON) | Done |
| `markdown` | Markdown docs | Done |
| `lambda` | AWS Lambda functions | Done |
| `python` | Python modules | Planned |
| `mcp-bridge` | Existing MCP servers | Planned |
| `database` | DB schema | Planned |

### Lambda functions

The lambda adapter handles AWS Lambda at scale. Point it at a manifest file you control, or let it scan your account directly. We built it for a client with 1000+ functions.

```javascript
// Manifest mode -- you define the schemas
export default {
  sdkName: 'platform',
  domains: [
    { name: 'payments', adapter: 'lambda', source: './manifests/payments.json' },
    { name: 'users', adapter: 'lambda', source: './manifests/users.json' },
  ],
};
```

```javascript
// AWS discovery mode -- reads functions and tags from your account
export default {
  sdkName: 'platform',
  domains: [
    { name: 'api', adapter: 'lambda', source: 'us-east-1' },
  ],
};
```

Full guide: [docs/lambda-adapter.md](docs/lambda-adapter.md)

## Architecture

```
User query → cmx_search → FTS5/BM25 index → typed SDK signatures (~500 tokens)
                                ↓
User code  → cmx_execute → AST validation → VM sandbox → sdk.domain.method() → HTTP / Lambda.invoke()
```

### Security

- AST validation blocks `require`, `import`, `fetch`, `process`, `eval`, and `Function`
- VM sandbox via `vm.createContext` with no Node globals exposed
- Credentials are injected at execution time only, never visible in LLM context
- Read-only by default; write operations require explicit opt-in

## CLI

```bash
# Interactive setup -- detects Express/OpenAPI files, generates config
npx codemode-x init

# Test config -- discovers tools and shows what Claude will see
npx codemode-x test

# Start as MCP server (stdio)
npx codemode-x start
```

### Adding to Claude Code

```bash
claude mcp add codemode-x -- node /path/to/codemode-x/plugin/start.mjs
```

## Development

```bash
npm install
npm run build
npm test

# Test against a live server (start your API first)
npm run test:live
```

## License

MIT

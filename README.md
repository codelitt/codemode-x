# codemode-x

Universal Code Mode Plugin for Claude Code. Compress any company's APIs, apps, and docs into **2 MCP tools** (~1,000 tokens) instead of N tools (100K+ tokens).

Claude writes TypeScript code against a typed SDK; code runs in a sandbox.

Built by [Carbon](https://www.carbonrei.com/) and [Codelitt](https://www.codelitt.com/).

## How It Works

```
cmx_search("properties rent data")           →  typed SDK signatures for matching tools
cmx_execute("await sdk.rentComps.getProperties()")  →  real API call, sandboxed
```

**Two tools. Any API.**

1. **`cmx_search(query)`** — discover available APIs/docs via FTS5 full-text search. Returns matching tool signatures + TS types for ONLY matched tools.
2. **`cmx_execute(code)`** — run TypeScript code using `sdk.<domain>.<method>()`. AST-validated, sandboxed, credentials injected at runtime.

## Quick Start

```bash
# Install
cd your-project
npm install codemode-x

# Create config pointing at your Express API
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

# Build & run as MCP server
npm run build
node plugin/start.mjs
```

## Real-World Example: Rent Comps

We built codemode-x to power our own rent comp analysis at Carbon. One config file turns an Express API into a typed SDK that Claude can search and call:

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
// "Get all properties and calculate average rent across the portfolio"
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
| `python` | Python modules | Planned |
| `mcp-bridge` | Existing MCP servers | Planned |
| `database` | DB schema | Planned |
| `lambda` | AWS Lambda functions | Planned |

## Architecture

```
User query → cmx_search → FTS5/BM25 index → typed SDK signatures (~500 tokens)
                                ↓
User code  → cmx_execute → AST validation → VM sandbox → sdk.domain.method() → HTTP/subprocess
```

### Security

- **AST validation**: blocks `require`, `import`, `fetch`, `process`, `eval`, `Function`
- **VM sandbox**: Node.js `vm.createContext` with no Node globals
- **Credentials**: never in LLM-visible types — injected at execution time only
- **Read-only by default**: explicit opt-in for write operations

## Development

```bash
npm install
npm run build
npm test
```

## License

MIT

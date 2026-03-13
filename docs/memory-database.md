# Memory Database

Use [memory-x](https://github.com/codelitt/memory-x) to create structured SQLite databases from your markdown files, then query them through codemode-x's database adapter.

## Quick Start

```bash
# Install memory-x
npm install -g memory-x

# Create and populate a memory database from your markdown
memoryx init
memoryx import ./CLAUDE.md

# Add to your codemode-x config
```

## How It Works

memory-x dynamically creates tables from any markdown tables it finds — no hardcoded schemas. Section headings become table names, table headers become columns.

codemode-x's database adapter then introspects the SQLite file and generates MCP tools automatically.

```
[Your markdown files] → [memory-x] → [memory.db] → [codemode-x database adapter] → [MCP tools]
```

## Config Example

Point the database adapter at your memory database:

```js
export default {
  sdkName: 'myapp',
  domains: [
    {
      name: 'memory',
      adapter: 'database',
      source: './memory.db',
      options: { writable: true },  // allows Claude to write live context
    },
    // ... other domains
  ],
};
```

Then Claude can query your context through auto-generated tools:

```
sdk.memory.queryPeople({ who: 'Alice' })
sdk.memory.queryTerms({ term: 'SLA' })
sdk.memory.rawQuery({ sql: "SELECT * FROM people WHERE _mx_section LIKE '%Investor%'" })
```

## Writable Mode

With `writable: true`, Claude can also insert/update/delete rows during conversations — useful for storing things it learns in real-time. memory-x tags imported rows with the source file path, while live writes get `_mx_source = 'live'`, so re-imports never overwrite what Claude learned.

## More Info

See the [memory-x README](https://github.com/codelitt/memory-x) for full documentation on importing, CLI commands, and configuration.

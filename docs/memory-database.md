# Memory Database

Structured LLM memory backed by SQLite. Import context from CLAUDE.md-style markdown files and query it through the database adapter.

## Quick Start

```bash
# Initialize a new memory database
npx codemode-x memory init

# Import from a markdown file
npx codemode-x memory import ./CLAUDE.md

# Add to your codemode-x config to query it
```

## Schema

The memory database has five tables:

| Table | Columns | Purpose |
|-------|---------|---------|
| `people` | name, role, notes, category | Team members, stakeholders, contacts |
| `properties` | name, type, notes | Key assets, products, resources |
| `entities` | name, description | Companies, projects, accounts |
| `terms` | term, meaning | Domain-specific terminology |
| `memories` | category, key, value, created_at | Generic key-value storage |

## CLI Commands

### `memory init [path]`

Create a new memory database with the schema. Defaults to `./memory.db`.

```bash
npx codemode-x memory init
npx codemode-x memory init ./data/memory.db
```

### `memory import <markdown> [db-path]`

Parse a markdown file and import tables into the database.

```bash
npx codemode-x memory import ./CLAUDE.md
npx codemode-x memory import ./CLAUDE.md ./data/memory.db
```

## Markdown Import Format

The importer detects table types from section headings:

- **People**: sections containing "team", "direct report", "investor", or "external"
- **Properties**: sections containing "portfolio", "propert", "asset", or "product"
- **Entities**: sections containing "entit", "organization", or "company"
- **Terms**: sections containing "term"
- **Memories**: anything else goes to generic key-value storage

### Example Markdown

```markdown
## Team
| Who | Role |
|-----|------|
| Alice | Engineering Lead |
| Bob | Designer |

## Portfolio
| Property | Notes |
|----------|-------|
| Auth Service | Core identity platform |
| Payment Gateway | Stripe integration |

## Terms
| Term | Meaning |
|------|---------|
| SLA | Service Level Agreement |
| RPO | Recovery Point Objective |
```

## Config Example

After creating and importing, add the memory database as a domain:

```js
export default {
  sdkName: 'myapp',
  domains: [
    {
      name: 'memory',
      adapter: 'database',
      source: './memory.db',
    },
    // ... other domains
  ],
};
```

Then Claude can query your context:

```
sdk.memory.queryPeople({ category: 'team' })
sdk.memory.queryTerms({ term: 'SLA' })
sdk.memory.rawQuery({ sql: "SELECT * FROM people WHERE role LIKE '%Lead%'" })
```

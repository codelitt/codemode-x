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
| `people` | name, role, notes, category | Team members, investors, contacts |
| `properties` | name, type, notes | Real estate portfolio |
| `entities` | name, description | Companies, funds, loans |
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
- **Properties**: sections containing "portfolio" or "propert"
- **Entities**: sections containing "entit"
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
| Sunset Apartments | 48 units, renovated 2024 |

## Terms
| Term | Meaning |
|------|---------|
| NOI | Net Operating Income |
```

## Config Example

After creating and importing, add the memory database as a domain:

```js
export default {
  sdkName: 'carbon',
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
sdk.memory.queryTerms({ term: 'NOI' })
sdk.memory.rawQuery({ sql: 'SELECT * FROM properties WHERE notes LIKE "%renovated%"' })
```

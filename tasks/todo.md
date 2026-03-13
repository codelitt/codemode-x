# memory-x: Split Plan

## The Problem
codemode-x had a `memory.ts` module with hardcoded schemas (people, properties, entities, terms) that wasn't general-purpose. The database adapter is generic and great. These needed to be two projects.

## Architecture

```
[Markdown files / CLAUDE.md / Claude memory dir]
        |
        v
  [memory-x]  ---- creates/manages ----> [memory.db]
                                              |
                                              v
  [codemode-x database adapter] --- introspects ---> [MCP tools]
```

**Contract between them: the SQLite file.** No shared code.

**Both write, for different reasons:**
- **memory-x writes bulk imports** — your CLAUDE.md, Claude's auto-memory files, project docs. The "rebuild the knowledge base" operation you run periodically. Idempotent, repeatable, you control it.
- **codemode-x writes live context** — things Claude learns mid-conversation via the writable database adapter. Small, incremental, real-time. Rows tagged with `_mx_source = 'live'`.
- **Clear separation:** memory-x marks imported rows with the source file path. Live rows get `_mx_source = 'live'`. Re-imports only touch file-sourced rows, never live ones. `memoryx reset --keep-live` rebuilds from files without losing what Claude learned.

---

## memory-x: Design

### Core Concept
A CLI tool + library that creates SQLite databases from markdown files. **Zero hardcoded schemas.** It dynamically infers table structures from the markdown it reads.

### Dynamic Schema

**Meta tables (always present, prefixed `_mx_`):**
- `_mx_tables` — tracks all dynamically created tables (name, source_file, source_section, timestamps)
- `_mx_columns` — tracks columns per table (name, original_header, position, inferred_type)
- `_mx_context` — key-value store for non-table content (bullet lists, paragraphs under headings)
- `_mx_imports` — import history with file hashes for idempotent re-imports

**Dynamic tables (created from markdown):**

When memory-x sees:
```markdown
## Team Members
| Name | Role | Department |
|------|------|------------|
| Alice | Engineer | Platform |
```

It creates:
```sql
CREATE TABLE team_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  role TEXT,
  department TEXT,
  _mx_source TEXT,
  _mx_imported_at TEXT DEFAULT (datetime('now'))
);
```

**Table naming:** Section heading → slugify (lowercase, underscores). If table exists with same columns, append rows. If different columns, create `_2` variant.

**Type inference:** Scan column values — all numeric → INTEGER/REAL, otherwise TEXT.

### Import Intelligence (No Hardcoded Names)
1. **Any markdown table → database table.** Heading = table name. No "team" vs "portfolio" detection.
2. **Non-table content → `_mx_context` key-value rows.** Bullets, paragraphs, etc.
3. **Idempotent re-imports.** Track file hashes. On re-import: drop rows from that source, re-insert.
4. **Multi-source.** Single file, directory (recursive), Claude memory dir, glob patterns.
5. **Optional config.** `.memoryx.config.js` for column aliases and merge rules — not required.

### CLI
```
memoryx init [path]                     Create empty memory database
memoryx import <source> [--db path]     Import markdown into database
memoryx status [--db path]              Show tables, row counts, history
memoryx tables [--db path]              List tables with columns
memoryx query <sql> [--db path]         Run read-only SQL
memoryx reset [--db path]               Drop imported rows, keep live context
memoryx reset --all [--db path]         Drop everything including live context
memoryx watch <source> [--db path]      Watch files and re-import on change
```

### Programmatic API
```typescript
import { MemoryDB } from 'memory-x';
const db = new MemoryDB('./memory.db');
await db.importFile('./CLAUDE.md');
const tables = db.listTables();
db.close();
```

---

## Implementation Checklist

### Phase 1: Create memory-x project
- [x] Init new repo `github.com/codelitt/memory-x`
- [x] Project structure (src/, tests/, fixtures)
- [x] Core importer: markdown table detection → dynamic CREATE TABLE → INSERT
- [x] Section heading → table name slugification + cleanHeading
- [x] Auto-merge tables with identical columns (_mx_section tracks origin)
- [x] Non-table content → `_mx_context` rows
- [x] Idempotent re-import (file hash tracking, source-based row deletion)
- [x] Type inference for columns
- [x] Claude memory directory support (frontmatter-aware)
- [x] CLI commands: init, import, status, tables, query, reset
- [x] 28/28 tests passing
- [x] Pushed to GitHub: https://github.com/codelitt/memory-x
- [ ] Optional `.memoryx.config.js` for aliases/merge rules (API exists, needs docs)

### Phase 2: Clean up codemode-x
- [x] **DELETE** `src/memory.ts`
- [x] **MODIFY** `adapters/database.ts` — removed `MEMORY_SCHEMA` import; auto-create makes empty DB
- [x] **MODIFY** `src/cli.ts` — removed `runMemory()` function and `memory` case; updated usage text
- [x] **MODIFY** `tests/adapters.test.ts` — removed Memory Module test block
- [x] **MODIFY** `docs/memory-database.md` — rewritten to reference memory-x
- [x] **DELETE** `ROLLBACK.md`
- [x] **UPDATE** `README.md` — references memory-x throughout
- [x] Build clean, 113/113 tests passing

### Phase 3: Integration verification
- [x] End-to-end test: memory-x imported CLAUDE.md → 4 tables + 52 context entries → clean table names
- [ ] Verify `_mx_*` meta tables can be excluded via `options: { exclude: [...] }` in codemode-x config
- [x] Document the setup flow in both READMEs

---

## Key Design Decisions

| Decision | Why |
|----------|-----|
| Dynamic tables (not EAV) | codemode-x's database adapter already introspects via PRAGMA — dynamic tables work with zero changes |
| `_mx_` prefix on meta tables | Avoids collision with user tables; easy to exclude in codemode-x config |
| No shared code | SQLite file is the contract — both projects evolve independently |
| Idempotent imports via file hash | Users can re-run `memoryx import` safely without duplicating data |
| Column aliases in config, not code | Current hardcoded "Who"→people detection is too brittle; optional config is more honest |

---

## Coupling Points to Cut (exact lines)

1. `adapters/database.ts:4` — `import { MEMORY_SCHEMA } from '../src/memory.js'` → remove
2. `adapters/database.ts:28-30` — auto-create with MEMORY_SCHEMA → create empty DB
3. `adapters/database.ts:242-246` — same auto-create in buildDatabaseQuerier → create empty DB
4. `src/cli.ts:29-31` — `case 'memory'` → remove
5. `src/cli.ts:294-322` — `runMemory()` → remove

# Changelog

## [0.3.2] - 2026-03-31

### Added
- **MCP server instructions** — Server now sends dynamic `instructions` during MCP initialization, built from loaded domains and project config. These load eagerly into the LLM's system prompt (not deferred with tools), ensuring codemode-x gets considered for data queries even when other MCP plugins compete for tool selection.

## [0.3.1] - 2026-03-31

### Added
- **Dynamic tool descriptions** — `cmx_search` and `cmx_execute` descriptions now auto-include available domains, tool counts, and sample tool names from the registry. Claude can see what the SDK offers without searching first.
- **`description` config field** — Projects can add context-specific description text (e.g., "Query rent data across 8 properties") that gets appended to both tool descriptions. Helps Claude select codemode-x over generic alternatives.
- Stronger routing language in `cmx_execute` description: "USE THIS for any data question — it already knows the schema, auth, and connections."

## [0.3.0] - 2026-03-30

### Fixed
- **FTS5 body content indexing** — search now indexes the full body content of markdown sections and tool descriptions, not just headings and metadata. Queries for terms that appear in document body text (e.g., specific technical terms, deployment details) now return relevant results.
- **Auth header injection** — HTTP-based tool implementations (Express, OpenAPI adapters) now inject authentication headers from environment variables at request time. Configured via `{ type: 'header', key: 'X-API-Key', envVar: 'MY_API_KEY' }` in domain auth config.
- **Version string** — MCP server now reports correct version (was stuck at 0.1.0).

### Added
- `HeaderAuthConfig` type for simple header-based API authentication.
- Tests for body content search and cross-section term discovery.

## [0.2.0] - 2026-03-16

### Changed
- Extracted memory database into standalone `memory-x` project.
- Removed Carbon-specific references from public repo.
- Generalized documentation and examples for open source.

### Added
- MCP Bridge adapter with 28 tests.
- Python adapter for subprocess-based function introspection.

## [0.1.0] - 2026-02-28

### Added
- Initial release: core engine with `cmx_search` and `cmx_execute` tools.
- Express, OpenAPI, and Markdown adapters.
- FTS5/BM25 search index.
- Sandboxed TypeScript execution via Node.js VM.
- CLI with `init`, `start`, and `test` commands.
- Lambda and Database adapters.

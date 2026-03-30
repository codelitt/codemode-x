# Changelog

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

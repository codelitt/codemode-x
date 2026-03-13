import Database from 'better-sqlite3';
import type { ToolDefinition, SearchResult } from './types.js';
import { generateToolTypes } from './typegen.js';

/** FTS5/BM25 search index for tool discovery */
export class SearchIndex {
  private db: Database.Database;

  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tools (
        key TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        domain TEXT NOT NULL,
        description TEXT NOT NULL,
        params TEXT NOT NULL,
        return_type TEXT NOT NULL,
        route TEXT,
        method TEXT,
        read_only INTEGER NOT NULL DEFAULT 1,
        definition TEXT NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS tools_fts USING fts5(
        key, name, domain, description, params, route, method,
        content=tools,
        content_rowid=rowid,
        tokenize='porter unicode61'
      );

      CREATE TRIGGER IF NOT EXISTS tools_ai AFTER INSERT ON tools BEGIN
        INSERT INTO tools_fts(rowid, key, name, domain, description, params, route, method)
        VALUES (new.rowid, new.key, new.name, new.domain, new.description, new.params, new.route, new.method);
      END;

      CREATE TRIGGER IF NOT EXISTS tools_ad AFTER DELETE ON tools BEGIN
        INSERT INTO tools_fts(tools_fts, rowid, key, name, domain, description, params, route, method)
        VALUES ('delete', old.rowid, old.key, old.name, old.domain, old.description, old.params, old.route, old.method);
      END;

      CREATE TRIGGER IF NOT EXISTS tools_au AFTER UPDATE ON tools BEGIN
        INSERT INTO tools_fts(tools_fts, rowid, key, name, domain, description, params, route, method)
        VALUES ('delete', old.rowid, old.key, old.name, old.domain, old.description, old.params, old.route, old.method);
        INSERT INTO tools_fts(rowid, key, name, domain, description, params, route, method)
        VALUES (new.rowid, new.key, new.name, new.domain, new.description, new.params, new.route, new.method);
      END;
    `);
  }

  /** Index a set of tool definitions */
  index(tools: ToolDefinition[]): void {
    const upsert = this.db.prepare(`
      INSERT OR REPLACE INTO tools (key, name, domain, description, params, return_type, route, method, read_only, definition)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = this.db.transaction((defs: ToolDefinition[]) => {
      for (const t of defs) {
        const key = `${t.domain}.${t.name}`;
        const paramStr = t.parameters.map(p => `${p.name}: ${p.type}`).join(', ');
        upsert.run(
          key, t.name, t.domain, t.description,
          paramStr, t.returnType, t.route ?? null, t.method ?? null,
          t.readOnly ? 1 : 0, JSON.stringify(t)
        );
      }
    });

    tx(tools);
  }

  /** Search for tools matching a query. Returns top results with generated types. */
  search(query: string, limit: number = 8): SearchResult[] {
    // Sanitize query for FTS5
    const sanitized = query.replace(/['"]/g, '').replace(/[^\w\s.-]/g, ' ').trim();
    if (!sanitized) return [];

    // Build FTS5 query: each word gets a prefix match
    const terms = sanitized.split(/\s+/).filter(Boolean);
    const ftsQuery = terms.map(t => `"${t}"*`).join(' OR ');

    const rows = this.db.prepare(`
      SELECT tools.key, tools.definition, tools_fts.rank
      FROM tools_fts
      JOIN tools ON tools.rowid = tools_fts.rowid
      WHERE tools_fts MATCH ?
      ORDER BY tools_fts.rank
      LIMIT ?
    `).all(ftsQuery, limit) as Array<{ key: string; definition: string; rank: number }>;

    return rows.map(row => {
      const tool: ToolDefinition = JSON.parse(row.definition);
      return {
        tool,
        score: -row.rank, // FTS5 rank is negative (lower = better), flip it
        typeSnippet: generateToolTypes(tool),
      };
    });
  }

  /** Get tool count */
  get size(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM tools').get() as { count: number };
    return row.count;
  }

  close(): void {
    this.db.close();
  }
}

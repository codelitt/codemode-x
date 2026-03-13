import { existsSync } from 'fs';
import { resolve } from 'path';
import type { Adapter, ToolDefinition, AdapterOptions, ParameterDef } from '../src/types.js';

/**
 * SQLite database adapter — introspects schema and generates query tools.
 *
 * Source: path to a .db/.sqlite file
 * Options (via DomainConfig.options):
 *   - tables: string[]   — only include these tables
 *   - exclude: string[]   — exclude these tables
 *
 * Generates:
 *   - One `query{TableName}` tool per table (columns as optional WHERE params)
 *   - One `rawQuery` tool accepting a SQL string (read-only validated)
 */
export const databaseAdapter: Adapter = {
  name: 'database',

  async parse(source: unknown, opts?: AdapterOptions): Promise<ToolDefinition[]> {
    const dbPath = resolve(String(source));
    const domain = opts?.domain ?? 'database';

    if (!existsSync(dbPath)) {
      throw new Error(`Database file not found: ${dbPath}`);
    }

    const options = (opts as any) ?? {};
    const includeTables: string[] | undefined = options.tables;
    const excludeTables: string[] | undefined = options.exclude;

    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath, { readonly: true });

    try {
      const tools: ToolDefinition[] = [];

      // Discover tables
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[];

      for (const { name: tableName } of tables) {
        if (includeTables && !includeTables.includes(tableName)) continue;
        if (excludeTables && excludeTables.includes(tableName)) continue;

        // Introspect columns via PRAGMA
        const columns = db.prepare(`PRAGMA table_info('${tableName}')`).all() as {
          cid: number;
          name: string;
          type: string;
          notnull: number;
          dflt_value: unknown;
          pk: number;
        }[];

        const parameters: ParameterDef[] = columns.map(col => ({
          name: col.name,
          type: mapSqliteType(col.type),
          required: false,
          description: `Filter by ${col.name}${col.pk ? ' (primary key)' : ''}`,
        }));

        const toolName = `query${tableName.charAt(0).toUpperCase()}${tableName.slice(1)}`;

        tools.push({
          name: toolName,
          domain,
          description: `Query the ${tableName} table. Pass column values to filter with WHERE clauses.`,
          parameters,
          returnType: `{ ${columns.map(c => `${c.name}: ${mapSqliteType(c.type)}`).join('; ')} }[]`,
          readOnly: true,
          transport: 'database',
          method: 'QUERY',
        });
      }

      // Add rawQuery tool
      tools.push({
        name: 'rawQuery',
        domain,
        description: 'Execute a read-only SQL query against the database. Only SELECT, PRAGMA, and EXPLAIN statements are allowed.',
        parameters: [
          {
            name: 'sql',
            type: 'string',
            required: true,
            description: 'SQL query to execute (SELECT/PRAGMA/EXPLAIN only)',
          },
        ],
        returnType: 'unknown[]',
        readOnly: true,
        transport: 'database',
        method: 'RAW',
      });

      return tools;
    } finally {
      db.close();
    }
  },
};

// ─── SQL Validation ──────────────────────────────────────────────

const ALLOWED_PREFIXES = ['SELECT', 'PRAGMA', 'EXPLAIN'];
const FORBIDDEN_KEYWORDS = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'REPLACE', 'ATTACH', 'DETACH'];

/**
 * Validate that a SQL string is read-only.
 * Rejects multi-statement queries and write operations.
 */
export function validateReadOnlySQL(sql: string): { valid: boolean; error?: string } {
  const trimmed = sql.trim();

  if (!trimmed) {
    return { valid: false, error: 'Empty SQL statement' };
  }

  // Reject multi-statement (semicolons not at the end)
  const withoutTrailingSemicolon = trimmed.replace(/;\s*$/, '');
  if (withoutTrailingSemicolon.includes(';')) {
    return { valid: false, error: 'Multi-statement queries are not allowed' };
  }

  // Check starts with allowed prefix
  const upperSql = trimmed.toUpperCase();
  const startsWithAllowed = ALLOWED_PREFIXES.some(p => upperSql.startsWith(p));
  if (!startsWithAllowed) {
    return { valid: false, error: `SQL must start with one of: ${ALLOWED_PREFIXES.join(', ')}` };
  }

  // Check for forbidden keywords (as whole words)
  for (const keyword of FORBIDDEN_KEYWORDS) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    if (regex.test(trimmed)) {
      return { valid: false, error: `Forbidden SQL keyword: ${keyword}` };
    }
  }

  return { valid: true };
}

// ─── Database Querier (used by server.ts) ────────────────────────

type ToolImplementation = (args: Record<string, unknown>) => Promise<unknown>;

/**
 * Build tool implementations for all database tools.
 * Opens the DB read-only and returns a Map of tool name → implementation.
 */
export async function buildDatabaseQuerier(dbPath: string): Promise<Map<string, ToolImplementation>> {
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(resolve(dbPath), { readonly: true });
  const implementations = new Map<string, ToolImplementation>();

  // Discover tables for per-table queriers
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];

  for (const { name: tableName } of tables) {
    const toolName = `query${tableName.charAt(0).toUpperCase()}${tableName.slice(1)}`;

    implementations.set(toolName, async (params: Record<string, unknown>) => {
      const conditions: string[] = [];
      const values: unknown[] = [];

      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          conditions.push(`"${key}" = ?`);
          values.push(value);
        }
      }

      let sql = `SELECT * FROM "${tableName}"`;
      if (conditions.length > 0) {
        sql += ` WHERE ${conditions.join(' AND ')}`;
      }

      return db.prepare(sql).all(...values);
    });
  }

  // Raw query implementation
  implementations.set('rawQuery', async (params: Record<string, unknown>) => {
    const sql = String(params.sql ?? '');
    const validation = validateReadOnlySQL(sql);
    if (!validation.valid) {
      throw new Error(`SQL validation failed: ${validation.error}`);
    }
    return db.prepare(sql).all();
  });

  return implementations;
}

// ─── Helpers ─────────────────────────────────────────────────────

/** Map SQLite column types to TypeScript types */
function mapSqliteType(sqlType: string): string {
  const upper = sqlType.toUpperCase();
  if (upper.includes('INT')) return 'number';
  if (upper.includes('REAL') || upper.includes('FLOAT') || upper.includes('DOUBLE') || upper.includes('NUMERIC')) return 'number';
  if (upper.includes('TEXT') || upper.includes('CHAR') || upper.includes('CLOB') || upper.includes('VARCHAR')) return 'string';
  if (upper.includes('BLOB')) return 'string';
  if (upper.includes('BOOL')) return 'boolean';
  return 'string';
}

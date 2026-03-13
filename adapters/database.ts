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
    const writable = opts?.writable === true;

    if (!existsSync(dbPath)) {
      if (writable) {
        // Auto-create an empty writable database (use memory-x to populate schema)
        const Database = (await import('better-sqlite3')).default;
        const db = new Database(dbPath);
        db.close();
        console.error(`[cmx] Auto-created empty writable database at ${dbPath}`);
      } else {
        throw new Error(`Database file not found: ${dbPath}`);
      }
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
        const capName = tableName.charAt(0).toUpperCase() + tableName.slice(1);

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

        // Generate write tools when writable
        if (writable) {
          const pkCol = columns.find(c => c.pk === 1);
          const nonPkColumns = columns.filter(c => c.pk !== 1);

          // insertX — all non-PK columns as params
          tools.push({
            name: `insert${capName}`,
            domain,
            description: `Insert a row into the ${tableName} table. Returns the new row ID and change count.`,
            parameters: nonPkColumns.map(col => ({
              name: col.name,
              type: mapSqliteType(col.type),
              required: col.notnull === 1 && col.dflt_value === null,
              description: `Value for ${col.name}`,
            })),
            returnType: '{ id: number; changes: number }',
            readOnly: false,
            transport: 'database',
            method: 'INSERT',
          });

          // updateX — PK required, other columns optional
          if (pkCol) {
            tools.push({
              name: `update${capName}`,
              domain,
              description: `Update a row in the ${tableName} table by ${pkCol.name}. Returns change count.`,
              parameters: [
                {
                  name: pkCol.name,
                  type: mapSqliteType(pkCol.type),
                  required: true,
                  description: `Primary key of the row to update`,
                },
                ...nonPkColumns.map(col => ({
                  name: col.name,
                  type: mapSqliteType(col.type),
                  required: false,
                  description: `New value for ${col.name}`,
                })),
              ],
              returnType: '{ changes: number }',
              readOnly: false,
              transport: 'database',
              method: 'UPDATE',
            });

            // deleteX — PK only
            tools.push({
              name: `delete${capName}`,
              domain,
              description: `Delete a row from the ${tableName} table by ${pkCol.name}. Returns change count.`,
              parameters: [
                {
                  name: pkCol.name,
                  type: mapSqliteType(pkCol.type),
                  required: true,
                  description: `Primary key of the row to delete`,
                },
              ],
              returnType: '{ changes: number }',
              readOnly: false,
              transport: 'database',
              method: 'DELETE',
            });
          }
        }
      }

      // Add rawQuery tool
      tools.push({
        name: 'rawQuery',
        domain,
        description: writable
          ? 'Execute a SQL query against the database. Supports SELECT, INSERT, UPDATE, DELETE, PRAGMA, and EXPLAIN statements.'
          : 'Execute a read-only SQL query against the database. Only SELECT, PRAGMA, and EXPLAIN statements are allowed.',
        parameters: [
          {
            name: 'sql',
            type: 'string',
            required: true,
            description: writable
              ? 'SQL query to execute'
              : 'SQL query to execute (SELECT/PRAGMA/EXPLAIN only)',
          },
        ],
        returnType: 'unknown[]',
        readOnly: !writable,
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
 * Opens the DB read-only by default; when writable, opens read-write and adds insert/update/delete.
 */
export async function buildDatabaseQuerier(dbPath: string, writable = false): Promise<Map<string, ToolImplementation>> {
  const resolvedPath = resolve(dbPath);
  const Database = (await import('better-sqlite3')).default;

  // Auto-create if writable and missing (use memory-x to populate schema)
  if (writable && !existsSync(resolvedPath)) {
    const initDb = new Database(resolvedPath);
    initDb.close();
    console.error(`[cmx] Auto-created empty writable database at ${resolvedPath}`);
  }

  const db = new Database(resolvedPath, { readonly: !writable });
  const implementations = new Map<string, ToolImplementation>();

  // Discover tables for per-table queriers
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];

  for (const { name: tableName } of tables) {
    const capName = tableName.charAt(0).toUpperCase() + tableName.slice(1);

    // Query tool (always present)
    implementations.set(`query${capName}`, async (params: Record<string, unknown>) => {
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

    if (writable) {
      // Introspect columns to find PK
      const columns = db.prepare(`PRAGMA table_info('${tableName}')`).all() as {
        cid: number; name: string; type: string; notnull: number; dflt_value: unknown; pk: number;
      }[];
      const pkCol = columns.find(c => c.pk === 1);
      const nonPkColumns = columns.filter(c => c.pk !== 1);

      // Insert
      implementations.set(`insert${capName}`, async (params: Record<string, unknown>) => {
        const cols: string[] = [];
        const placeholders: string[] = [];
        const values: unknown[] = [];

        for (const col of nonPkColumns) {
          if (params[col.name] !== undefined) {
            cols.push(`"${col.name}"`);
            placeholders.push('?');
            values.push(params[col.name]);
          }
        }

        if (cols.length === 0) {
          throw new Error('No columns provided for insert');
        }

        const sql = `INSERT INTO "${tableName}" (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`;
        const result = db.prepare(sql).run(...values);
        return { id: result.lastInsertRowid, changes: result.changes };
      });

      // Update (requires PK)
      if (pkCol) {
        implementations.set(`update${capName}`, async (params: Record<string, unknown>) => {
          const pkValue = params[pkCol.name];
          if (pkValue === undefined || pkValue === null) {
            throw new Error(`Primary key "${pkCol.name}" is required for update`);
          }

          const setClauses: string[] = [];
          const values: unknown[] = [];

          for (const col of nonPkColumns) {
            if (params[col.name] !== undefined) {
              setClauses.push(`"${col.name}" = ?`);
              values.push(params[col.name]);
            }
          }

          if (setClauses.length === 0) {
            throw new Error('No fields provided to update');
          }

          values.push(pkValue);
          const sql = `UPDATE "${tableName}" SET ${setClauses.join(', ')} WHERE "${pkCol.name}" = ?`;
          const result = db.prepare(sql).run(...values);
          return { changes: result.changes };
        });

        // Delete
        implementations.set(`delete${capName}`, async (params: Record<string, unknown>) => {
          const pkValue = params[pkCol.name];
          if (pkValue === undefined || pkValue === null) {
            throw new Error(`Primary key "${pkCol.name}" is required for delete`);
          }

          const sql = `DELETE FROM "${tableName}" WHERE "${pkCol.name}" = ?`;
          const result = db.prepare(sql).run(pkValue);
          return { changes: result.changes };
        });
      }
    }
  }

  // Raw query implementation
  implementations.set('rawQuery', async (params: Record<string, unknown>) => {
    const sql = String(params.sql ?? '');

    if (writable) {
      // In writable mode, allow write SQL but still reject multi-statement
      const trimmed = sql.trim();
      const withoutTrailing = trimmed.replace(/;\s*$/, '');
      if (withoutTrailing.includes(';')) {
        throw new Error('Multi-statement queries are not allowed');
      }
      // Detect write vs read by SQL prefix
      const upperSql = trimmed.toUpperCase();
      const isWrite = ['INSERT', 'UPDATE', 'DELETE', 'REPLACE'].some(p => upperSql.startsWith(p));
      if (isWrite) {
        const result = db.prepare(sql).run();
        return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
      }
      return db.prepare(sql).all();
    }

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

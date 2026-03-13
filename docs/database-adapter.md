# Database Adapter

Query any SQLite database through codemode-x. The database adapter introspects your schema and generates type-safe query tools automatically.

## Configuration

```js
export default {
  sdkName: 'myapp',
  domains: [
    {
      name: 'data',
      adapter: 'database',
      source: './my-database.db',
      options: {
        // Optional: only expose specific tables
        tables: ['users', 'orders'],
        // Or exclude specific tables
        // exclude: ['internal_logs'],
      },
    },
  ],
};
```

## Generated Tools

For each table, the adapter creates a `query{TableName}` tool with all columns as optional filter parameters. It also creates a single `rawQuery` tool for arbitrary read-only SQL.

### Per-Table Query Tools

Given a `users` table with columns `(id INTEGER, name TEXT, email TEXT)`:

```
sdk.data.queryUsers()                    // SELECT * FROM users
sdk.data.queryUsers({ name: 'Alice' })   // SELECT * FROM users WHERE name = 'Alice'
sdk.data.queryUsers({ id: 1 })           // SELECT * FROM users WHERE id = 1
```

### Raw Query Tool

```
sdk.data.rawQuery({ sql: 'SELECT u.name, COUNT(o.id) FROM users u JOIN orders o ON u.id = o.user_id GROUP BY u.name' })
```

## SQL Validation

The `rawQuery` tool enforces read-only access:

**Allowed:** `SELECT`, `PRAGMA`, `EXPLAIN`

**Rejected:**
- `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `CREATE`
- Multi-statement queries (multiple statements separated by `;`)

## Column Type Mapping

| SQLite Type | TypeScript Type |
|-------------|-----------------|
| INTEGER, INT | number |
| REAL, FLOAT, DOUBLE, NUMERIC | number |
| TEXT, VARCHAR, CHAR, CLOB | string |
| BLOB | string |
| BOOLEAN | boolean |

## Table Filtering

Use `options.tables` to whitelist specific tables, or `options.exclude` to blacklist them:

```js
// Only expose these tables
options: { tables: ['users', 'orders'] }

// Expose everything except these
options: { exclude: ['migrations', 'sessions'] }
```

## Database Access

The database is always opened in **read-only mode**. No write operations are possible through the adapter, even if SQL validation were somehow bypassed.

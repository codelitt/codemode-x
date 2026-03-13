import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'path';
import { mkdtempSync, writeFileSync, unlinkSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { openapiAdapter } from '../adapters/openapi.js';
import { markdownAdapter } from '../adapters/markdown.js';
import { lambdaAdapter } from '../adapters/lambda.js';
import { databaseAdapter, validateReadOnlySQL, buildDatabaseQuerier } from '../adapters/database.js';
import { SearchIndex } from '../src/search.js';
import { formatSearchResults } from '../src/typegen.js';
import type { ToolDefinition } from '../src/types.js';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');

// ─── OpenAPI Adapter ─────────────────────────────────────────────

describe('OpenAPI Adapter', () => {
  let tools: ToolDefinition[];

  beforeAll(async () => {
    tools = await openapiAdapter.parse(
      resolve(FIXTURES, 'rent-comps-api.json'),
      { domain: 'rentComps' }
    );
  });

  it('discovers all operations', () => {
    expect(tools.length).toBe(5);
  });

  it('uses operationId as tool name when available', () => {
    const names = tools.map(t => t.name);
    expect(names).toContain('listProperties');
    expect(names).toContain('createProperty');
    expect(names).toContain('getPropertyById');
    expect(names).toContain('deleteProperty');
  });

  it('generates name for operations without operationId', () => {
    // /properties/{propertyId}/comps GET has no operationId
    const comps = tools.find(t => t.route === '/properties/{propertyId}/comps');
    expect(comps).toBeDefined();
    expect(comps!.name).toBe('getPropertiesComps');
  });

  it('extracts path parameters as required', () => {
    const getById = tools.find(t => t.name === 'getPropertyById');
    expect(getById).toBeDefined();
    const propId = getById!.parameters.find(p => p.name === 'propertyId');
    expect(propId).toBeDefined();
    expect(propId!.required).toBe(true);
    expect(propId!.type).toBe('string');
  });

  it('extracts query parameters as optional', () => {
    const list = tools.find(t => t.name === 'listProperties');
    expect(list).toBeDefined();
    const limit = list!.parameters.find(p => p.name === 'limit');
    expect(limit).toBeDefined();
    expect(limit!.required).toBe(false);
    expect(limit!.type).toBe('number');
  });

  it('extracts request body properties as parameters', () => {
    const create = tools.find(t => t.name === 'createProperty');
    expect(create).toBeDefined();
    const nameParam = create!.parameters.find(p => p.name === 'name');
    expect(nameParam).toBeDefined();
    expect(nameParam!.required).toBe(true);
    expect(nameParam!.type).toBe('string');

    const addressParam = create!.parameters.find(p => p.name === 'address');
    expect(addressParam).toBeDefined();
    expect(addressParam!.required).toBe(false);
  });

  it('resolves $ref return types', () => {
    const getById = tools.find(t => t.name === 'getPropertyById');
    expect(getById).toBeDefined();
    expect(getById!.returnType).toContain('id');
    expect(getById!.returnType).toContain('name');
  });

  it('resolves array of $ref return types', () => {
    const list = tools.find(t => t.name === 'listProperties');
    expect(list!.returnType).toContain('[]');
    expect(list!.returnType).toContain('id');
  });

  it('resolves enum types', () => {
    const getById = tools.find(t => t.name === 'getPropertyById');
    expect(getById!.returnType).toContain('"A"');
    expect(getById!.returnType).toContain('"B"');
  });

  it('marks GET/DELETE as readOnly', () => {
    expect(tools.find(t => t.name === 'listProperties')!.readOnly).toBe(true);
    expect(tools.find(t => t.name === 'deleteProperty')!.readOnly).toBe(true);
    expect(tools.find(t => t.name === 'createProperty')!.readOnly).toBe(false);
  });

  it('uses summary as description', () => {
    const list = tools.find(t => t.name === 'listProperties');
    expect(list!.description).toBe('List all properties');
  });

  it('sets domain on all tools', () => {
    for (const tool of tools) {
      expect(tool.domain).toBe('rentComps');
    }
  });

  it('integrates with search index', () => {
    const index = new SearchIndex();
    index.index(tools);

    const results = index.search('property');
    expect(results.length).toBeGreaterThan(0);

    const formatted = formatSearchResults('carbon', results);
    expect(formatted).toContain('sdk');
    expect(formatted).toContain('rentComps');
  });
});

// ─── Markdown Adapter ────────────────────────────────────────────

describe('Markdown Adapter', () => {
  let tools: ToolDefinition[];

  beforeAll(async () => {
    tools = await markdownAdapter.parse(
      resolve(FIXTURES, 'sample-docs.md'),
      { domain: 'docs' }
    );
  });

  it('splits markdown into sections by headings', () => {
    expect(tools.length).toBeGreaterThan(0);
  });

  it('creates a tool per section with content in examples', () => {
    for (const tool of tools) {
      expect(tool.domain).toBe('docs');
      expect(tool.readOnly).toBe(true);
      expect(tool.examples).toBeDefined();
      expect(tool.examples!.length).toBeGreaterThan(0);
    }
  });

  it('includes section titles in descriptions', () => {
    const titles = tools.map(t => t.description);
    expect(titles.some(t => t.includes('Data Collection'))).toBe(true);
    expect(titles.some(t => t.includes('Properties'))).toBe(true);
    expect(titles.some(t => t.includes('Rent Analysis'))).toBe(true);
    expect(titles.some(t => t.includes('Market Reports'))).toBe(true);
  });

  it('includes section content in examples', () => {
    const dataCollection = tools.find(t => t.description.includes('Data Collection'));
    expect(dataCollection).toBeDefined();
    expect(dataCollection!.examples![0]).toContain('listing sources');
  });

  it('generates slugified IDs', () => {
    for (const tool of tools) {
      expect(tool.name).toMatch(/^[a-z0-9_]+$/);
    }
  });

  it('integrates with search index — finds docs by topic', () => {
    const index = new SearchIndex();
    index.index(tools);

    const results = index.search('rent analysis');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].tool.description).toContain('Rent Analysis');
  });

  it('handles directory glob patterns', async () => {
    const dirTools = await markdownAdapter.parse(FIXTURES, { domain: 'docs' });
    expect(dirTools.length).toBeGreaterThan(0);
  });
});

// ─── Lambda Adapter ──────────────────────────────────────────────

describe('Lambda Adapter (manifest mode)', () => {
  let tools: ToolDefinition[];

  beforeAll(async () => {
    tools = await lambdaAdapter.parse(
      resolve(FIXTURES, 'lambda-manifest.json'),
      { domain: 'payments' }
    );
  });

  it('discovers all functions from manifest', () => {
    expect(tools.length).toBe(6);
  });

  it('generates camelCase tool names from Lambda function names', () => {
    const names = tools.map(t => t.name).sort();
    expect(names).toContain('processPayment');
    expect(names).toContain('getTransaction');
    expect(names).toContain('getUser');
    expect(names).toContain('updateUser');
    expect(names).toContain('listProducts');
    expect(names).toContain('createOrder');
  });

  it('extracts input parameters with types', () => {
    const processPayment = tools.find(t => t.name === 'processPayment')!;
    expect(processPayment.parameters.length).toBe(3);

    const amount = processPayment.parameters.find(p => p.name === 'amount')!;
    expect(amount.type).toBe('number');
    expect(amount.required).toBe(true);

    const currency = processPayment.parameters.find(p => p.name === 'currency')!;
    expect(currency.type).toBe('string');
    expect(currency.required).toBe(false);
  });

  it('sets return types from manifest output field', () => {
    const getTx = tools.find(t => t.name === 'getTransaction')!;
    expect(getTx.returnType).toContain('transactionId');
    expect(getTx.returnType).toContain('string');
  });

  it('marks readOnly correctly', () => {
    expect(tools.find(t => t.name === 'getTransaction')!.readOnly).toBe(true);
    expect(tools.find(t => t.name === 'processPayment')!.readOnly).toBe(false);
    expect(tools.find(t => t.name === 'createOrder')!.readOnly).toBe(false);
    expect(tools.find(t => t.name === 'listProducts')!.readOnly).toBe(true);
  });

  it('stores function name in route field', () => {
    const processPayment = tools.find(t => t.name === 'processPayment')!;
    expect(processPayment.route).toBe('myapp-payments-processPayment');
  });

  it('sets transport to lambda', () => {
    for (const tool of tools) {
      expect(tool.transport).toBe('lambda');
      expect(tool.method).toBe('INVOKE');
    }
  });

  it('sets domain on all tools', () => {
    for (const tool of tools) {
      expect(tool.domain).toBe('payments');
    }
  });

  it('integrates with search index', () => {
    const index = new SearchIndex();
    index.index(tools);

    const results = index.search('payment transaction');
    expect(results.length).toBeGreaterThan(0);

    const formatted = formatSearchResults('myapp', results);
    expect(formatted).toContain('sdk');
    expect(formatted).toContain('payments');
    expect(formatted).toContain('processPayment');
  });

  it('handles complex parameter types', () => {
    const createOrder = tools.find(t => t.name === 'createOrder')!;
    const shipping = createOrder.parameters.find(p => p.name === 'shippingAddress')!;
    expect(shipping.type).toContain('street');
    expect(shipping.type).toContain('city');
  });
});

// ─── Cross-adapter search ────────────────────────────────────────

describe('Cross-Adapter Search', () => {
  it('finds results across OpenAPI + Markdown domains', async () => {
    const apiTools = await openapiAdapter.parse(
      resolve(FIXTURES, 'rent-comps-api.json'),
      { domain: 'rentComps' }
    );
    const docTools = await markdownAdapter.parse(
      resolve(FIXTURES, 'sample-docs.md'),
      { domain: 'docs' }
    );

    const index = new SearchIndex();
    index.index([...apiTools, ...docTools]);

    // Search that could match both domains
    const results = index.search('properties');
    expect(results.length).toBeGreaterThan(0);

    // API-specific search
    const compResults = index.search('comps property');
    expect(compResults.length).toBeGreaterThan(0);
    const compDomains = compResults.map(r => r.tool.domain);
    expect(compDomains).toContain('rentComps');

    // Doc-specific search
    const marketResults = index.search('market reports');
    expect(marketResults.length).toBeGreaterThan(0);
    expect(marketResults[0].tool.domain).toBe('docs');
  });
});

// ─── Database Adapter ─────────────────────────────────────────────

describe('Database Adapter', () => {
  let tools: ToolDefinition[];
  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    // Create a temp SQLite DB with users + orders tables
    tmpDir = mkdtempSync(join(tmpdir(), 'cmx-db-test-'));
    dbPath = join(tmpDir, 'test.db');

    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath);

    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT,
        age INTEGER
      );
      CREATE TABLE orders (
        id INTEGER PRIMARY KEY,
        user_id INTEGER,
        amount REAL,
        status TEXT DEFAULT 'pending'
      );
      INSERT INTO users VALUES (1, 'Alice', 'alice@test.com', 30);
      INSERT INTO users VALUES (2, 'Bob', 'bob@test.com', 25);
      INSERT INTO users VALUES (3, 'Charlie', 'charlie@test.com', 35);
      INSERT INTO orders VALUES (1, 1, 99.99, 'completed');
      INSERT INTO orders VALUES (2, 1, 49.50, 'pending');
      INSERT INTO orders VALUES (3, 2, 150.00, 'completed');
    `);
    db.close();

    tools = await databaseAdapter.parse(dbPath, { domain: 'testdb' });
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('discovers all tables', () => {
    // 2 table query tools + 1 rawQuery = 3
    expect(tools.length).toBe(3);
  });

  it('generates query tools per table', () => {
    const names = tools.map(t => t.name);
    expect(names).toContain('queryUsers');
    expect(names).toContain('queryOrders');
    expect(names).toContain('rawQuery');
  });

  it('generates parameters from columns', () => {
    const queryUsers = tools.find(t => t.name === 'queryUsers')!;
    expect(queryUsers.parameters.length).toBe(4);

    const idParam = queryUsers.parameters.find(p => p.name === 'id')!;
    expect(idParam.type).toBe('number');
    expect(idParam.required).toBe(false);

    const nameParam = queryUsers.parameters.find(p => p.name === 'name')!;
    expect(nameParam.type).toBe('string');

    const ageParam = queryUsers.parameters.find(p => p.name === 'age')!;
    expect(ageParam.type).toBe('number');
  });

  it('maps column types correctly', () => {
    const queryOrders = tools.find(t => t.name === 'queryOrders')!;
    const amount = queryOrders.parameters.find(p => p.name === 'amount')!;
    expect(amount.type).toBe('number');

    const status = queryOrders.parameters.find(p => p.name === 'status')!;
    expect(status.type).toBe('string');
  });

  it('marks all tools as readOnly', () => {
    for (const tool of tools) {
      expect(tool.readOnly).toBe(true);
    }
  });

  it('sets transport to database', () => {
    for (const tool of tools) {
      expect(tool.transport).toBe('database');
    }
  });

  it('sets domain on all tools', () => {
    for (const tool of tools) {
      expect(tool.domain).toBe('testdb');
    }
  });

  it('filters tables with options.tables (include)', async () => {
    const filtered = await databaseAdapter.parse(dbPath, {
      domain: 'testdb',
      tables: ['users'],
    } as any);
    const names = filtered.map(t => t.name);
    expect(names).toContain('queryUsers');
    expect(names).not.toContain('queryOrders');
    expect(names).toContain('rawQuery'); // rawQuery is always included
  });

  it('filters tables with options.exclude', async () => {
    const filtered = await databaseAdapter.parse(dbPath, {
      domain: 'testdb',
      exclude: ['orders'],
    } as any);
    const names = filtered.map(t => t.name);
    expect(names).toContain('queryUsers');
    expect(names).not.toContain('queryOrders');
  });

  it('throws for non-existent database file', async () => {
    await expect(
      databaseAdapter.parse('/nonexistent/path.db', { domain: 'test' })
    ).rejects.toThrow('Database file not found');
  });
});

// ─── SQL Validation ──────────────────────────────────────────────

describe('SQL Validation', () => {
  it('allows SELECT statements', () => {
    expect(validateReadOnlySQL('SELECT * FROM users').valid).toBe(true);
    expect(validateReadOnlySQL('SELECT id, name FROM users WHERE age > 25').valid).toBe(true);
  });

  it('allows PRAGMA statements', () => {
    expect(validateReadOnlySQL('PRAGMA table_info("users")').valid).toBe(true);
  });

  it('allows EXPLAIN statements', () => {
    expect(validateReadOnlySQL('EXPLAIN SELECT * FROM users').valid).toBe(true);
  });

  it('rejects INSERT statements', () => {
    const result = validateReadOnlySQL('INSERT INTO users VALUES (1, "test")');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects UPDATE statements', () => {
    const result = validateReadOnlySQL('UPDATE users SET name = "test"');
    expect(result.valid).toBe(false);
  });

  it('rejects DELETE statements', () => {
    const result = validateReadOnlySQL('DELETE FROM users');
    expect(result.valid).toBe(false);
  });

  it('rejects DROP statements', () => {
    const result = validateReadOnlySQL('DROP TABLE users');
    expect(result.valid).toBe(false);
  });

  it('rejects ALTER statements', () => {
    const result = validateReadOnlySQL('ALTER TABLE users ADD COLUMN foo TEXT');
    expect(result.valid).toBe(false);
  });

  it('rejects multi-statement queries', () => {
    const result = validateReadOnlySQL('SELECT 1; DROP TABLE users');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Multi-statement');
  });

  it('allows trailing semicolons', () => {
    expect(validateReadOnlySQL('SELECT * FROM users;').valid).toBe(true);
  });

  it('rejects empty SQL', () => {
    expect(validateReadOnlySQL('').valid).toBe(false);
    expect(validateReadOnlySQL('   ').valid).toBe(false);
  });
});

// ─── Database Querier (runtime) ──────────────────────────────────

describe('Database Querier', () => {
  let tmpDir: string;
  let dbPath: string;
  let querier: Map<string, (args: Record<string, unknown>) => Promise<unknown>>;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cmx-querier-test-'));
    dbPath = join(tmpDir, 'test.db');

    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT);
      INSERT INTO users VALUES (1, 'Alice', 'alice@test.com');
      INSERT INTO users VALUES (2, 'Bob', 'bob@test.com');
    `);
    db.close();

    querier = await buildDatabaseQuerier(dbPath);
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('executes table query without filters', async () => {
    const results = await querier.get('queryUsers')!({}) as any[];
    expect(results.length).toBe(2);
    expect(results[0].name).toBe('Alice');
  });

  it('filters table query by params', async () => {
    const results = await querier.get('queryUsers')!({ name: 'Bob' }) as any[];
    expect(results.length).toBe(1);
    expect(results[0].email).toBe('bob@test.com');
  });

  it('executes raw SELECT query', async () => {
    const results = await querier.get('rawQuery')!({ sql: 'SELECT COUNT(*) as cnt FROM users' }) as any[];
    expect(results[0].cnt).toBe(2);
  });

  it('rejects raw INSERT query', async () => {
    await expect(
      querier.get('rawQuery')!({ sql: "INSERT INTO users VALUES (3, 'Eve', 'eve@test.com')" })
    ).rejects.toThrow('SQL validation failed');
  });

  it('rejects raw DROP query', async () => {
    await expect(
      querier.get('rawQuery')!({ sql: 'DROP TABLE users' })
    ).rejects.toThrow('SQL validation failed');
  });
});

// ─── Memory Module ───────────────────────────────────────────────

describe('Memory Module', () => {
  let tmpDir: string;
  let dbPath: string;
  let mdPath: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cmx-memory-test-'));
    dbPath = join(tmpDir, 'memory.db');
    mdPath = join(tmpDir, 'test.md');

    // Create a test markdown file
    writeFileSync(mdPath, `# Test Project

## People — Direct Reports & Team
| Who | Role |
|-----|------|
| **Alice** | Engineering Lead |
| **Bob** | Designer |

## People — Investors & External
| Who | Role |
|-----|------|
| **Charlie** | Lead Investor |

## Portfolio — Properties
| Property | Notes |
|----------|-------|
| Sunset Apartments | 48 units |
| Oak Plaza | 120 units, renovated |

## Other Entities
| Name | What |
|------|------|
| Blue Fund | Investment vehicle |

## Terms
| Term | Meaning |
|------|---------|
| NOI | Net Operating Income |
| Cap Rate | Capitalization Rate |
`);
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('initializes memory database with all tables', async () => {
    const { initMemoryDb } = await import('../src/memory.js');
    initMemoryDb(dbPath);

    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath, { readonly: true });

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];

    const tableNames = tables.map(t => t.name).sort();
    expect(tableNames).toContain('people');
    expect(tableNames).toContain('properties');
    expect(tableNames).toContain('entities');
    expect(tableNames).toContain('terms');
    expect(tableNames).toContain('memories');

    db.close();
  });

  it('imports markdown tables correctly', async () => {
    const { importMarkdown } = await import('../src/memory.js');
    importMarkdown(dbPath, mdPath);

    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath, { readonly: true });

    // Check people
    const people = db.prepare('SELECT * FROM people').all() as any[];
    expect(people.length).toBe(3);
    const alice = people.find((p: any) => p.name === 'Alice');
    expect(alice).toBeDefined();
    expect(alice.role).toBe('Engineering Lead');
    expect(alice.category).toBe('team');

    const charlie = people.find((p: any) => p.name === 'Charlie');
    expect(charlie).toBeDefined();
    expect(charlie.category).toBe('investor');

    // Check properties
    const properties = db.prepare('SELECT * FROM properties').all() as any[];
    expect(properties.length).toBe(2);
    expect(properties.some((p: any) => p.name === 'Sunset Apartments')).toBe(true);

    // Check entities
    const entities = db.prepare('SELECT * FROM entities').all() as any[];
    expect(entities.length).toBe(1);
    expect(entities[0].name).toBe('Blue Fund');

    // Check terms
    const terms = db.prepare('SELECT * FROM terms').all() as any[];
    expect(terms.length).toBe(2);
    expect(terms.some((t: any) => t.term === 'NOI')).toBe(true);
    expect(terms.some((t: any) => t.term === 'Cap Rate')).toBe(true);

    db.close();
  });
});

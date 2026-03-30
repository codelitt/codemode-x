import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'path';
import { mkdtempSync, writeFileSync, unlinkSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { openapiAdapter } from '../adapters/openapi.js';
import { markdownAdapter } from '../adapters/markdown.js';
import { lambdaAdapter } from '../adapters/lambda.js';
import { databaseAdapter, validateReadOnlySQL, buildDatabaseQuerier } from '../adapters/database.js';
import { pythonAdapter, buildPythonInvoker } from '../adapters/python.js';
import {
  mcpBridgeAdapter,
  buildMcpBridgeInvoker,
  parseServerConfig,
  extractParameters,
  mapJsonSchemaType,
  inferReadOnly,
} from '../adapters/mcp-bridge.js';
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

  it('search finds terms in section body content, not just headings', () => {
    const index = new SearchIndex();
    index.index(tools);

    // "listing sources" appears only in the Data Collection body, not in any heading
    const results = index.search('listing sources');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].tool.description).toContain('Data Collection');
  });

  it('search finds body-only terms across different sections', () => {
    const index = new SearchIndex();
    index.index(tools);

    // "vacancy" appears only in the Rent Analysis body
    const results = index.search('vacancy');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].tool.description).toContain('Rent Analysis');

    // "occupancy rates" appears only in the Market Reports body
    const ratesResults = index.search('occupancy rates');
    expect(ratesResults.length).toBeGreaterThan(0);
    expect(ratesResults[0].tool.description).toContain('Market Reports');
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

// ─── Memory Module (moved to memory-x) ─────────────────────────
// Memory import/schema tests are now in the memory-x project.
// See: https://github.com/codelitt/memory-x


// ─── Python Adapter ──────────────────────────────────────────────

describe('Python Adapter', () => {
  let tools: ToolDefinition[];

  beforeAll(async () => {
    tools = await pythonAdapter.parse(
      resolve(FIXTURES, 'sample-module.py'),
      { domain: 'pymod' }
    );
  });

  it('discovers public functions', () => {
    expect(tools.length).toBe(4);
  });

  it('skips private functions (underscore prefix)', () => {
    const names = tools.map(t => t.name);
    expect(names).not.toContain('_internal_helper');
  });

  it('extracts function names', () => {
    const names = tools.map(t => t.name).sort();
    expect(names).toContain('get_users');
    expect(names).toContain('get_user_by_id');
    expect(names).toContain('create_user');
    expect(names).toContain('calculate_total');
  });

  it('extracts parameters with types', () => {
    const getUsers = tools.find(t => t.name === 'get_users')!;
    expect(getUsers.parameters.length).toBe(2);

    const limit = getUsers.parameters.find(p => p.name === 'limit')!;
    expect(limit.type).toBe('number');
    expect(limit.required).toBe(false);

    const active = getUsers.parameters.find(p => p.name === 'active')!;
    expect(active.type).toBe('boolean');
  });

  it('marks required parameters correctly', () => {
    const createUser = tools.find(t => t.name === 'create_user')!;
    const name = createUser.parameters.find(p => p.name === 'name')!;
    expect(name.required).toBe(true);
    expect(name.type).toBe('string');

    const role = createUser.parameters.find(p => p.name === 'role')!;
    expect(role.required).toBe(false);
  });

  it('extracts docstring as description', () => {
    const getUsers = tools.find(t => t.name === 'get_users')!;
    expect(getUsers.description).toContain('Fetch a list of users');
  });

  it('maps Python return types to TypeScript', () => {
    const calcTotal = tools.find(t => t.name === 'calculate_total')!;
    expect(calcTotal.returnType).toBe('number');

    const getUsers = tools.find(t => t.name === 'get_users')!;
    expect(getUsers.returnType).toContain('[]');
  });

  it('infers readOnly from function name', () => {
    expect(tools.find(t => t.name === 'get_users')!.readOnly).toBe(true);
    expect(tools.find(t => t.name === 'get_user_by_id')!.readOnly).toBe(true);
    expect(tools.find(t => t.name === 'create_user')!.readOnly).toBe(false);
    expect(tools.find(t => t.name === 'calculate_total')!.readOnly).toBe(true);
  });

  it('sets transport to python', () => {
    for (const tool of tools) {
      expect(tool.transport).toBe('python');
    }
  });

  it('sets domain on all tools', () => {
    for (const tool of tools) {
      expect(tool.domain).toBe('pymod');
    }
  });

  it('filters functions with options.functions (include)', async () => {
    const filtered = await pythonAdapter.parse(
      resolve(FIXTURES, 'sample-module.py'),
      { domain: 'pymod', functions: ['get_users', 'get_user_by_id'] } as any,
    );
    expect(filtered.length).toBe(2);
    const names = filtered.map(t => t.name);
    expect(names).toContain('get_users');
    expect(names).toContain('get_user_by_id');
    expect(names).not.toContain('create_user');
  });

  it('filters functions with options.exclude', async () => {
    const filtered = await pythonAdapter.parse(
      resolve(FIXTURES, 'sample-module.py'),
      { domain: 'pymod', exclude: ['create_user'] } as any,
    );
    const names = filtered.map(t => t.name);
    expect(names).not.toContain('create_user');
    expect(names).toContain('get_users');
  });

  it('throws for non-existent Python file', async () => {
    await expect(
      pythonAdapter.parse('/nonexistent/module.py', { domain: 'test' })
    ).rejects.toThrow('Python source not found');
  });

  it('integrates with search index', () => {
    const index = new SearchIndex();
    index.index(tools);

    const results = index.search('users');
    expect(results.length).toBeGreaterThan(0);
  });
});

// ─── Python Invoker (runtime) ────────────────────────────────────

describe('Python Invoker', () => {
  const fixturePath = resolve(FIXTURES, 'sample-module.py');

  it('invokes a function and returns result', async () => {
    const invoker = buildPythonInvoker(fixturePath, `${fixturePath}::get_user_by_id`);
    const result = await invoker({ user_id: '42' }) as any;
    expect(result.id).toBe('42');
    expect(result.name).toBe('Alice');
  });

  it('invokes a function with default params', async () => {
    const invoker = buildPythonInvoker(fixturePath, `${fixturePath}::get_users`);
    const result = await invoker({ limit: 5 }) as any[];
    expect(Array.isArray(result)).toBe(true);
  });

  it('invokes calculate_total correctly', async () => {
    const invoker = buildPythonInvoker(fixturePath, `${fixturePath}::calculate_total`);
    const result = await invoker({ prices: [10, 20, 30], tax_rate: 0.1 });
    expect(result).toBeCloseTo(66.0);
  });
});

// ─── MCP Bridge Adapter — Helper Unit Tests ─────────────────────

describe('MCP Bridge — parseServerConfig', () => {
  it('parses a simple command string', () => {
    const config = parseServerConfig('node my-server.js');
    expect(config.command).toBe('node');
    expect(config.args).toEqual(['my-server.js']);
  });

  it('parses a command string with multiple args', () => {
    const config = parseServerConfig('python -m my_server --port 3000');
    expect(config.command).toBe('python');
    expect(config.args).toEqual(['-m', 'my_server', '--port', '3000']);
  });

  it('parses an object config with command and args', () => {
    const config = parseServerConfig({ command: 'node', args: ['server.js'], env: { PORT: '8080' } });
    expect(config.command).toBe('node');
    expect(config.args).toEqual(['server.js']);
    expect(config.env).toEqual({ PORT: '8080' });
  });

  it('defaults args to empty array for object config', () => {
    const config = parseServerConfig({ command: 'node' });
    expect(config.args).toEqual([]);
  });

  it('throws for object without command field', () => {
    expect(() => parseServerConfig({ args: ['foo'] })).toThrow('must have a "command" field');
  });

  it('throws for null', () => {
    expect(() => parseServerConfig(null)).toThrow('must be a command string');
  });

  it('throws for number', () => {
    expect(() => parseServerConfig(42)).toThrow('must be a command string');
  });
});

describe('MCP Bridge — extractParameters', () => {
  it('returns empty array for undefined schema', () => {
    expect(extractParameters(undefined)).toEqual([]);
  });

  it('returns empty array for schema without properties', () => {
    expect(extractParameters({ type: 'object' })).toEqual([]);
  });

  it('extracts properties with required flags', () => {
    const params = extractParameters({
      type: 'object',
      properties: {
        name: { type: 'string', description: 'User name' },
        age: { type: 'integer' },
      },
      required: ['name'],
    });
    expect(params.length).toBe(2);

    const name = params.find(p => p.name === 'name')!;
    expect(name.type).toBe('string');
    expect(name.required).toBe(true);
    expect(name.description).toBe('User name');

    const age = params.find(p => p.name === 'age')!;
    expect(age.type).toBe('number');
    expect(age.required).toBe(false);
  });

  it('handles nested object and array types', () => {
    const params = extractParameters({
      type: 'object',
      properties: {
        tags: { type: 'array', items: { type: 'string' } },
        address: { type: 'object', properties: { city: { type: 'string' } } },
      },
    });
    const tags = params.find(p => p.name === 'tags')!;
    expect(tags.type).toBe('string[]');

    const address = params.find(p => p.name === 'address')!;
    expect(address.type).toContain('city');
  });
});

describe('MCP Bridge — mapJsonSchemaType', () => {
  it('maps string', () => expect(mapJsonSchemaType({ type: 'string' })).toBe('string'));
  it('maps number', () => expect(mapJsonSchemaType({ type: 'number' })).toBe('number'));
  it('maps integer to number', () => expect(mapJsonSchemaType({ type: 'integer' })).toBe('number'));
  it('maps boolean', () => expect(mapJsonSchemaType({ type: 'boolean' })).toBe('boolean'));
  it('maps null', () => expect(mapJsonSchemaType({ type: 'null' })).toBe('null'));
  it('maps array of strings', () => expect(mapJsonSchemaType({ type: 'array', items: { type: 'string' } })).toBe('string[]'));
  it('maps array without items', () => expect(mapJsonSchemaType({ type: 'array' })).toBe('unknown[]'));
  it('maps object with properties', () => {
    const result = mapJsonSchemaType({ type: 'object', properties: { x: { type: 'number' } } });
    expect(result).toBe('{ x: number }');
  });
  it('maps object without properties', () => expect(mapJsonSchemaType({ type: 'object' })).toBe('Record<string, unknown>'));
  it('returns unknown for missing schema', () => expect(mapJsonSchemaType(null)).toBe('unknown'));
  it('returns unknown for missing type', () => expect(mapJsonSchemaType({})).toBe('unknown'));
  it('returns unknown for unrecognized type', () => expect(mapJsonSchemaType({ type: 'custom' })).toBe('unknown'));
});

describe('MCP Bridge — inferReadOnly', () => {
  it('returns true for read-like names', () => {
    expect(inferReadOnly('get_users')).toBe(true);
    expect(inferReadOnly('listItems')).toBe(true);
    expect(inferReadOnly('search_orders')).toBe(true);
    expect(inferReadOnly('fetch_data')).toBe(true);
  });

  it('returns false for write-like names', () => {
    expect(inferReadOnly('create_user')).toBe(false);
    expect(inferReadOnly('updateItem')).toBe(false);
    expect(inferReadOnly('delete_order')).toBe(false);
    expect(inferReadOnly('sendEmail')).toBe(false);
    expect(inferReadOnly('post_message')).toBe(false);
    expect(inferReadOnly('insertRecord')).toBe(false);
  });
});

// ─── MCP Bridge Adapter — Integration Tests ─────────────────────

const MCP_ECHO_SERVER = resolve(FIXTURES, 'mcp-echo-server.js');

describe('MCP Bridge — parse() integration', () => {
  let tools: ToolDefinition[];

  beforeAll(async () => {
    tools = await mcpBridgeAdapter.parse(
      `node ${MCP_ECHO_SERVER}`,
      { domain: 'echo' },
    );
  }, 15000);

  it('discovers all tools from the echo server', () => {
    expect(tools.length).toBe(3);
    const names = tools.map(t => t.name).sort();
    expect(names).toEqual(['add_numbers', 'create_item', 'get_echo']);
  });

  it('extracts parameters correctly', () => {
    const echo = tools.find(t => t.name === 'get_echo')!;
    expect(echo.parameters.length).toBe(1);
    expect(echo.parameters[0].name).toBe('message');
    expect(echo.parameters[0].type).toBe('string');

    const add = tools.find(t => t.name === 'add_numbers')!;
    expect(add.parameters.length).toBe(2);
  });

  it('infers readOnly correctly', () => {
    expect(tools.find(t => t.name === 'get_echo')!.readOnly).toBe(true);
    expect(tools.find(t => t.name === 'add_numbers')!.readOnly).toBe(true);
    expect(tools.find(t => t.name === 'create_item')!.readOnly).toBe(false);
  });

  it('sets domain and transport', () => {
    for (const tool of tools) {
      expect(tool.domain).toBe('echo');
      expect(tool.transport).toBe('mcp');
    }
  });

  it('applies include filter', async () => {
    const filtered = await mcpBridgeAdapter.parse(
      `node ${MCP_ECHO_SERVER}`,
      { domain: 'echo', tools: ['get_echo'] } as any,
    );
    expect(filtered.length).toBe(1);
    expect(filtered[0].name).toBe('get_echo');
  }, 15000);

  it('applies exclude filter', async () => {
    const filtered = await mcpBridgeAdapter.parse(
      `node ${MCP_ECHO_SERVER}`,
      { domain: 'echo', exclude: ['create_item'] } as any,
    );
    const names = filtered.map(t => t.name);
    expect(names).not.toContain('create_item');
    expect(names).toContain('get_echo');
  }, 15000);
});

describe('MCP Bridge — buildMcpBridgeInvoker() integration', () => {
  let implementations: Map<string, (args: Record<string, unknown>) => Promise<unknown>>;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const result = await buildMcpBridgeInvoker(`node ${MCP_ECHO_SERVER}`);
    implementations = result.implementations;
    close = result.close;
  }, 15000);

  afterAll(async () => {
    await close();
  });

  it('discovers all tool implementations', () => {
    expect(implementations.size).toBe(3);
    expect(implementations.has('get_echo')).toBe(true);
    expect(implementations.has('add_numbers')).toBe(true);
    expect(implementations.has('create_item')).toBe(true);
  });

  it('calls get_echo and returns parsed result', async () => {
    const result = await implementations.get('get_echo')!({ message: 'hello' }) as any;
    expect(result.echoed).toBe('hello');
  });

  it('calls add_numbers and returns correct sum', async () => {
    const result = await implementations.get('add_numbers')!({ a: 3, b: 7 }) as any;
    expect(result.result).toBe(10);
  });

  it('calls create_item with optional param', async () => {
    const result = await implementations.get('create_item')!({ name: 'Widget', category: 'tools' }) as any;
    expect(result.name).toBe('Widget');
    expect(result.category).toBe('tools');
    expect(result.id).toBe('123');
  });
});

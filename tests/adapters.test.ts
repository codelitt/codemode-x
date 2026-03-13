import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'path';
import { openapiAdapter } from '../adapters/openapi.js';
import { markdownAdapter } from '../adapters/markdown.js';
import { lambdaAdapter } from '../adapters/lambda.js';
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

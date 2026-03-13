import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { Adapter, ToolDefinition, AdapterOptions, ParameterDef } from '../src/types.js';

/** Method → name prefix mapping */
const METHOD_PREFIX: Record<string, string> = {
  get: 'get',
  post: 'create',
  put: 'update',
  patch: 'update',
  delete: 'delete',
};

/** Express adapter — introspects an Express app's source to extract route definitions */
export const expressAdapter: Adapter = {
  name: 'express',

  async parse(source: unknown, opts?: AdapterOptions): Promise<ToolDefinition[]> {
    const filePath = resolve(String(source));
    const code = readFileSync(filePath, 'utf-8');
    const domain = opts?.domain ?? 'api';

    const ast = acorn.parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'module',
    });

    const routes = extractRoutes(ast, code);
    return routes.map(r => routeToTool(r, domain, opts));
  },
};

interface RouteInfo {
  method: string;       // get, post, put, delete
  path: string;         // /api/properties/:id
  handlerBody: string;  // The handler function source
}

/** Walk the AST to find app.get/post/put/delete calls */
function extractRoutes(ast: acorn.Node, source: string): RouteInfo[] {
  const routes: RouteInfo[] = [];

  walk.simple(ast, {
    CallExpression(node: any) {
      // Match app.get(), app.post(), etc.
      if (
        node.callee?.type === 'MemberExpression' &&
        node.callee.object?.name === 'app' &&
        node.callee.property?.type === 'Identifier'
      ) {
        const method = node.callee.property.name.toLowerCase();
        if (!['get', 'post', 'put', 'delete', 'patch'].includes(method)) return;

        // First arg should be the route string
        const pathArg = node.arguments[0];
        if (!pathArg || pathArg.type !== 'Literal' || typeof pathArg.value !== 'string') return;

        const path = pathArg.value;

        // Last arg is the handler (arrow fn or function expression)
        const handler = node.arguments[node.arguments.length - 1];
        if (!handler) return;

        const handlerBody = source.slice(handler.start, handler.end);

        routes.push({ method, path, handlerBody });
      }
    },
  });

  return routes;
}

/** Convert a route to a ToolDefinition */
function routeToTool(route: RouteInfo, domain: string, opts?: AdapterOptions): ToolDefinition {
  const { method, path, handlerBody } = route;
  const isReadOnly = method === 'get' || method === 'delete';

  // Generate a camelCase name from the route
  const name = generateToolName(method, path);

  // Extract route params
  const routeParams = extractRouteParams(path);

  // Extract body params by analyzing req.body usage
  const bodyParams = method !== 'get' ? extractBodyParams(handlerBody) : [];

  // Extract query params by analyzing req.query usage
  const queryParams = method === 'get' ? extractQueryParams(handlerBody) : [];

  // Generate description from route info
  const description = generateDescription(method, path, handlerBody);

  // Infer return type from handler analysis
  const returnType = inferReturnType(handlerBody);

  const parameters: ParameterDef[] = [
    ...routeParams.map(p => ({
      name: p,
      type: 'string | number',
      required: true,
      description: `Route parameter: ${p}`,
    })),
    ...queryParams.map(p => ({
      name: p,
      type: 'string',
      required: false,
      description: `Query parameter: ${p}`,
    })),
    ...bodyParams.map(p => ({
      name: p.name,
      type: p.type,
      required: p.required,
      description: p.description,
    })),
  ];

  return {
    name,
    domain,
    description,
    parameters,
    returnType,
    readOnly: isReadOnly,
    route: path,
    method: method.toUpperCase(),
    auth: opts?.auth?.provider,
  };
}

/** Generate a camelCase tool name from HTTP method + route path */
function generateToolName(method: string, path: string): string {
  const prefix = METHOD_PREFIX[method] || method;

  // Clean up the path: /api/properties/:id → PropertiesById
  const segments = path
    .replace(/^\/api\//, '') // Strip /api/ prefix
    .replace(/^\//, '')       // Strip leading slash for non-api routes
    .split('/')
    .filter(s => s && !s.startsWith(':'));

  // Check for route params to determine if it's a "ById" operation
  const hasParams = path.includes(':');
  const paramNames = (path.match(/:(\w+)/g) || []).map(p => p.slice(1));

  // Convert each segment: "rent-data" → "RentData", "properties" → "Properties"
  let name = segments
    .map(seg => seg
      .split(/[-_]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join('')
    )
    .join('');

  // For parameterized routes, add context
  if (hasParams && paramNames.length === 1 && segments.length === 1) {
    name += `By${paramNames[0].charAt(0).toUpperCase() + paramNames[0].slice(1)}`;
  }

  return prefix + name;
}

/** Extract route parameters like :id from path */
function extractRouteParams(path: string): string[] {
  return (path.match(/:(\w+)/g) || []).map(p => p.slice(1));
}

/** Extract body params by looking for req.body destructuring and property access */
function extractBodyParams(handlerBody: string): Array<{ name: string; type: string; required: boolean; description: string }> {
  const params: Array<{ name: string; type: string; required: boolean; description: string }> = [];
  const seen = new Set<string>();

  // Match destructuring: const { name, address, ... } = req.body
  const destructureMatch = handlerBody.match(/(?:const|let|var)\s*\{([^}]+)\}\s*=\s*req\.body/);
  if (destructureMatch) {
    const names = destructureMatch[1].split(',').map(s => s.trim().split('=')[0].trim().split(':')[0].trim());
    for (const name of names) {
      if (name && !seen.has(name)) {
        seen.add(name);
        params.push({
          name,
          type: inferParamType(name, handlerBody),
          required: !handlerBody.includes(`${name} ||`) && !handlerBody.includes(`${name} ??`),
          description: `Body parameter: ${name}`,
        });
      }
    }
  }

  // Match direct property access: req.body.name
  const propMatches = handlerBody.matchAll(/req\.body\.(\w+)/g);
  for (const match of propMatches) {
    const name = match[1];
    if (name && !seen.has(name)) {
      seen.add(name);
      params.push({
        name,
        type: inferParamType(name, handlerBody),
        required: true,
        description: `Body parameter: ${name}`,
      });
    }
  }

  return params;
}

/** Extract query params from req.query usage */
function extractQueryParams(handlerBody: string): string[] {
  const params: string[] = [];
  const seen = new Set<string>();

  // Match destructuring: const { x } = req.query
  const destructureMatch = handlerBody.match(/(?:const|let|var)\s*\{([^}]+)\}\s*=\s*req\.query/);
  if (destructureMatch) {
    const names = destructureMatch[1].split(',').map(s => s.trim().split('=')[0].trim());
    for (const name of names) {
      if (name && !seen.has(name)) {
        seen.add(name);
        params.push(name);
      }
    }
  }

  // Match req.query.x
  const propMatches = handlerBody.matchAll(/req\.query\.(\w+)/g);
  for (const match of propMatches) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      params.push(match[1]);
    }
  }

  return params;
}

/** Infer parameter type from variable name conventions */
function inferParamType(name: string, context: string): string {
  if (name.endsWith('_id') || name === 'id' || name === 'units' || name === 'year_built') return 'number';
  if (name === 'is_subject' || name.startsWith('is_')) return 'boolean';
  if (name === 'unit_types' || name === 'floor_plans' || name === 'concessions') return 'any[]';
  if (name === 'data' || name === 'comps') return 'any[]';
  if (name === 'subject') return 'Record<string, any>';
  return 'string';
}

/** Generate a human-readable description from route info */
function generateDescription(method: string, path: string, body: string): string {
  const action = { get: 'Retrieve', post: 'Create', put: 'Update', patch: 'Update', delete: 'Delete' }[method] || method;

  // Extract resource name from path
  const resource = path
    .replace(/^\/api\//, '')
    .replace(/\/:[^/]+/g, '')
    .replace(/-/g, ' ')
    .replace(/\//g, ' ')
    .trim();

  // Check for specific patterns in handler body for better descriptions
  if (body.includes('is_subject = true') || body.includes('is_subject')) {
    if (path.includes('list')) return `Get list of subject properties (id and name only)`;
  }

  const hasRouteParam = path.includes(':');
  if (hasRouteParam && method === 'get') {
    return `${action} a specific ${singularize(resource)} by ID`;
  }

  return `${action} ${resource}`;
}

function singularize(word: string): string {
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/** Infer return type from handler body analysis */
function inferReturnType(body: string): string {
  // Check for common patterns
  if (body.includes('rows') && body.includes('res.json')) {
    if (body.includes('[0]') || body.includes('rows[0]')) return 'Record<string, any>';
    return 'Record<string, any>[]';
  }

  if (body.includes('message') && body.includes('res.status(201)')) {
    return '{ id?: number; message: string }';
  }

  if (body.includes('res.json({')) {
    return 'Record<string, any>';
  }

  return 'unknown';
}

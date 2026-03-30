import { readFileSync } from 'fs';
import { resolve } from 'path';
import { isScopeAuth, type Adapter, type ToolDefinition, type AdapterOptions, type ParameterDef } from '../src/types.js';

/** Method → name prefix mapping */
const METHOD_PREFIX: Record<string, string> = {
  get: 'get',
  post: 'create',
  put: 'update',
  patch: 'update',
  delete: 'delete',
};

/**
 * OpenAPI 3.x adapter — parses a Swagger/OpenAPI spec file (JSON or YAML-as-JSON)
 * and converts each operation into a ToolDefinition.
 */
export const openapiAdapter: Adapter = {
  name: 'openapi',

  async parse(source: unknown, opts?: AdapterOptions): Promise<ToolDefinition[]> {
    const filePath = resolve(String(source));
    const raw = readFileSync(filePath, 'utf-8');
    const spec = JSON.parse(raw) as OpenAPISpec;
    const domain = opts?.domain ?? 'api';

    return extractOperations(spec, domain, opts);
  },
};

// ─── OpenAPI Types (minimal subset) ──────────────────────────────

interface OpenAPISpec {
  openapi?: string;
  info?: { title?: string; version?: string };
  paths?: Record<string, PathItem>;
  components?: { schemas?: Record<string, SchemaObject> };
}

interface PathItem {
  get?: OperationObject;
  post?: OperationObject;
  put?: OperationObject;
  patch?: OperationObject;
  delete?: OperationObject;
  parameters?: ParameterObject[];
}

interface OperationObject {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: ParameterObject[];
  requestBody?: RequestBodyObject;
  responses?: Record<string, ResponseObject>;
  tags?: string[];
  deprecated?: boolean;
}

interface ParameterObject {
  name: string;
  in: 'query' | 'path' | 'header' | 'cookie';
  required?: boolean;
  description?: string;
  schema?: SchemaObject;
}

interface RequestBodyObject {
  required?: boolean;
  content?: Record<string, { schema?: SchemaObject }>;
  description?: string;
}

interface ResponseObject {
  description?: string;
  content?: Record<string, { schema?: SchemaObject }>;
}

interface SchemaObject {
  type?: string;
  format?: string;
  items?: SchemaObject;
  properties?: Record<string, SchemaObject>;
  required?: string[];
  $ref?: string;
  allOf?: SchemaObject[];
  oneOf?: SchemaObject[];
  anyOf?: SchemaObject[];
  enum?: unknown[];
  description?: string;
  additionalProperties?: boolean | SchemaObject;
}

// ─── Extraction ──────────────────────────────────────────────────

function extractOperations(spec: OpenAPISpec, domain: string, opts?: AdapterOptions): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  const schemas = spec.components?.schemas ?? {};

  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    const pathParams = pathItem.parameters ?? [];

    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const op = pathItem[method];
      if (!op || op.deprecated) continue;

      const allParams = [...pathParams, ...(op.parameters ?? [])];
      const name = op.operationId ?? generateName(method, path);
      const description = op.summary ?? op.description ?? `${method.toUpperCase()} ${path}`;

      // Build parameters
      const parameters: ParameterDef[] = [];

      // Path + query params
      for (const p of allParams) {
        if (p.in === 'header' || p.in === 'cookie') continue;
        parameters.push({
          name: p.name,
          type: schemaToType(p.schema, schemas),
          required: p.required ?? p.in === 'path',
          description: p.description,
        });
      }

      // Request body params
      if (op.requestBody) {
        const bodySchema = getBodySchema(op.requestBody);
        if (bodySchema) {
          if (bodySchema.properties) {
            for (const [propName, propSchema] of Object.entries(bodySchema.properties)) {
              parameters.push({
                name: propName,
                type: schemaToType(propSchema, schemas),
                required: bodySchema.required?.includes(propName) ?? false,
                description: propSchema.description,
              });
            }
          } else {
            // Non-object body — add as single "body" param
            parameters.push({
              name: 'body',
              type: schemaToType(bodySchema, schemas),
              required: op.requestBody.required ?? false,
              description: op.requestBody.description,
            });
          }
        }
      }

      // Infer return type from 200/201 response
      const returnType = inferReturnType(op.responses, schemas);
      const readOnly = method === 'get' || method === 'delete';

      tools.push({
        name,
        domain,
        description,
        parameters,
        returnType,
        readOnly,
        route: path,
        method: method.toUpperCase(),
        auth: isScopeAuth(opts?.auth) ? opts.auth.provider : undefined,
      });
    }
  }

  return tools;
}

// ─── Helpers ─────────────────────────────────────────────────────

function generateName(method: string, path: string): string {
  const prefix = METHOD_PREFIX[method] || method;
  const segments = path
    .replace(/^\//, '')
    .split('/')
    .filter(s => s && !s.startsWith('{'));

  const name = segments
    .map(seg => seg
      .split(/[-_]/)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join('')
    )
    .join('');

  const hasParams = path.includes('{');
  const paramNames = (path.match(/\{(\w+)\}/g) || []).map(p => p.slice(1, -1));

  let result = prefix + name;
  if (hasParams && paramNames.length === 1 && segments.length === 1) {
    result += `By${paramNames[0].charAt(0).toUpperCase() + paramNames[0].slice(1)}`;
  }

  return result;
}

function resolveRef(ref: string | undefined, schemas: Record<string, SchemaObject>): SchemaObject | undefined {
  if (!ref) return undefined;
  // #/components/schemas/PropertyResponse → PropertyResponse
  const name = ref.split('/').pop();
  return name ? schemas[name] : undefined;
}

function schemaToType(schema: SchemaObject | undefined, schemas: Record<string, SchemaObject>): string {
  if (!schema) return 'unknown';

  // Handle $ref
  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, schemas);
    if (resolved) return schemaToType(resolved, schemas);
    const refName = schema.$ref.split('/').pop() ?? 'unknown';
    return refName;
  }

  // Handle allOf/oneOf/anyOf
  if (schema.allOf) {
    const types = schema.allOf.map(s => schemaToType(s, schemas));
    return types.join(' & ');
  }
  if (schema.oneOf || schema.anyOf) {
    const items = schema.oneOf ?? schema.anyOf ?? [];
    const types = items.map(s => schemaToType(s, schemas));
    return types.join(' | ');
  }

  // Handle enum
  if (schema.enum) {
    return schema.enum.map(v => typeof v === 'string' ? `"${v}"` : String(v)).join(' | ');
  }

  switch (schema.type) {
    case 'string': return 'string';
    case 'integer':
    case 'number': return 'number';
    case 'boolean': return 'boolean';
    case 'array': {
      const itemType = schemaToType(schema.items, schemas);
      return `${itemType}[]`;
    }
    case 'object': {
      if (!schema.properties) {
        if (schema.additionalProperties && typeof schema.additionalProperties !== 'boolean') {
          return `Record<string, ${schemaToType(schema.additionalProperties, schemas)}>`;
        }
        return 'Record<string, unknown>';
      }
      const props = Object.entries(schema.properties).map(([k, v]) => {
        const optional = schema.required?.includes(k) ? '' : '?';
        return `${k}${optional}: ${schemaToType(v, schemas)}`;
      });
      return `{ ${props.join('; ')} }`;
    }
    default: return 'unknown';
  }
}

function getBodySchema(body: RequestBodyObject): SchemaObject | undefined {
  const content = body.content;
  if (!content) return undefined;
  const json = content['application/json'] ?? content['*/*'];
  return json?.schema;
}

function inferReturnType(
  responses: Record<string, ResponseObject> | undefined,
  schemas: Record<string, SchemaObject>
): string {
  if (!responses) return 'unknown';

  // Check 200, 201, 2XX in order
  const successResp = responses['200'] ?? responses['201'] ?? responses['2XX'] ?? responses['default'];
  if (!successResp?.content) return 'void';

  const json = successResp.content['application/json'] ?? successResp.content['*/*'];
  if (!json?.schema) return 'unknown';

  return schemaToType(json.schema, schemas);
}

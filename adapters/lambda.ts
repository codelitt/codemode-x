import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { Adapter, ToolDefinition, AdapterOptions, ParameterDef } from '../src/types.js';

/**
 * AWS Lambda adapter — discovers Lambda functions and converts them to
 * ToolDefinitions. Supports two modes:
 *
 * 1. **Manifest file** (source points to a .json file):
 *    A JSON file listing functions with their schemas. Best for teams that
 *    want explicit control over which functions are exposed.
 *
 * 2. **AWS discovery** (source is a region string like "us-east-1"):
 *    Calls ListFunctions via the AWS SDK, reads schemas from function tags
 *    or description metadata. Requires @aws-sdk/client-lambda installed.
 *
 * Functions are invoked via Lambda.invoke() at execution time, not HTTP.
 */
export const lambdaAdapter: Adapter = {
  name: 'lambda',

  async parse(source: unknown, opts?: AdapterOptions): Promise<ToolDefinition[]> {
    const sourceStr = String(source);
    const domain = opts?.domain ?? 'lambda';

    // Mode 1: Manifest file
    if (sourceStr.endsWith('.json') && existsSync(resolve(sourceStr))) {
      return parseManifest(resolve(sourceStr), domain, opts);
    }

    // Mode 2: AWS discovery (source is a region)
    return discoverFromAWS(sourceStr, domain, opts);
  },
};

// ─── Manifest Types ──────────────────────────────────────────────

interface LambdaManifest {
  region: string;
  prefix?: string;
  functions: ManifestFunction[];
}

interface ManifestFunction {
  functionName: string;
  description?: string;
  input?: Record<string, ManifestParam>;
  output?: string;                        // TS type string
  readOnly?: boolean;
  tags?: Record<string, string>;
}

interface ManifestParam {
  type: string;
  required?: boolean;
  description?: string;
  default?: unknown;
}

// ─── Mode 1: Manifest File ──────────────────────────────────────

function parseManifest(
  filePath: string,
  domain: string,
  opts?: AdapterOptions
): ToolDefinition[] {
  const raw = readFileSync(filePath, 'utf-8');
  const manifest: LambdaManifest = JSON.parse(raw);

  return manifest.functions.map(fn => manifestFnToTool(fn, domain, manifest.region, opts));
}

function manifestFnToTool(
  fn: ManifestFunction,
  domain: string,
  region: string,
  opts?: AdapterOptions
): ToolDefinition {
  const parameters: ParameterDef[] = [];

  if (fn.input) {
    for (const [name, param] of Object.entries(fn.input)) {
      parameters.push({
        name,
        type: param.type,
        required: param.required ?? true,
        description: param.description,
        default: param.default,
      });
    }
  }

  // Generate a clean camelCase name from the function name
  const toolName = lambdaNameToToolName(fn.functionName);

  return {
    name: toolName,
    domain,
    description: fn.description ?? `Invoke Lambda: ${fn.functionName}`,
    parameters,
    returnType: fn.output ?? 'unknown',
    readOnly: fn.readOnly ?? inferReadOnly(fn.functionName),
    route: fn.functionName,          // Store the actual function name/ARN
    method: 'INVOKE',
    transport: 'lambda',
    auth: opts?.auth?.provider,
  };
}

// ─── Mode 2: AWS Discovery ──────────────────────────────────────

async function discoverFromAWS(
  region: string,
  domain: string,
  opts?: AdapterOptions
): Promise<ToolDefinition[]> {
  // Dynamic import so @aws-sdk/client-lambda is optional
  let LambdaClient: any;
  let ListFunctionsCommand: any;
  let ListTagsCommand: any;

  try {
    // @ts-ignore — optional peer dependency
    const sdk = await import('@aws-sdk/client-lambda');
    LambdaClient = sdk.LambdaClient;
    ListFunctionsCommand = sdk.ListFunctionsCommand;
    ListTagsCommand = sdk.ListTagsCommand;
  } catch {
    throw new Error(
      'AWS Lambda discovery requires @aws-sdk/client-lambda.\n' +
      'Install it: npm install @aws-sdk/client-lambda\n' +
      'Or use a manifest file instead (see docs/lambda-adapter.md).'
    );
  }

  const client = new LambdaClient({ region });
  const tools: ToolDefinition[] = [];

  // Extract filter options
  const prefix = (opts as any)?.prefix as string | undefined;
  const tagFilter = (opts as any)?.tags as Record<string, string> | undefined;

  let marker: string | undefined;

  do {
    const response = await client.send(new ListFunctionsCommand({
      Marker: marker,
      MaxItems: 50,
    }));

    for (const fn of response.Functions ?? []) {
      const fnName = fn.FunctionName;
      if (!fnName) continue;

      // Apply prefix filter
      if (prefix && !fnName.startsWith(prefix)) continue;

      // Get tags for schema discovery and filtering
      let tags: Record<string, string> = {};
      try {
        const tagResponse = await client.send(new ListTagsCommand({
          Resource: fn.FunctionArn,
        }));
        tags = tagResponse.Tags ?? {};
      } catch {
        // Tags might not be accessible — continue without them
      }

      // Apply tag filter
      if (tagFilter) {
        const matches = Object.entries(tagFilter).every(([k, v]) => tags[k] === v);
        if (!matches) continue;
      }

      // Build tool definition from function metadata + tags
      const tool = awsFnToTool(fn, tags, domain, opts);
      if (tool) tools.push(tool);
    }

    marker = response.NextMarker;
  } while (marker);

  return tools;
}

function awsFnToTool(
  fn: any,
  tags: Record<string, string>,
  domain: string,
  opts?: AdapterOptions
): ToolDefinition | null {
  const fnName = fn.FunctionName as string;
  const description = fn.Description || `Lambda function: ${fnName}`;

  // Try to extract schema from tags
  // Convention: cmx:input = JSON schema, cmx:output = TS type string
  const parameters: ParameterDef[] = [];
  let returnType = 'unknown';

  if (tags['cmx:input']) {
    try {
      const inputSchema = JSON.parse(tags['cmx:input']);
      for (const [name, schema] of Object.entries(inputSchema as Record<string, any>)) {
        parameters.push({
          name,
          type: schema.type ?? 'unknown',
          required: schema.required ?? true,
          description: schema.description,
        });
      }
    } catch {
      // Invalid tag JSON — skip schema
    }
  }

  if (tags['cmx:output']) {
    returnType = tags['cmx:output'];
  }

  // Use cmx:readonly tag, or infer from name
  const readOnly = tags['cmx:readonly'] === 'true' || inferReadOnly(fnName);

  // Skip if explicitly excluded
  if (tags['cmx:exclude'] === 'true') return null;

  return {
    name: lambdaNameToToolName(fnName),
    domain,
    description,
    parameters,
    returnType,
    readOnly,
    route: fnName,
    method: 'INVOKE',
    transport: 'lambda',
    auth: opts?.auth?.provider,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Convert a Lambda function name to a camelCase tool name.
 * "myapp-payments-processPayment" → "processPayment"
 * "myapp_get_user_by_id" → "getUserById"
 * "GetOrderStatus" → "getOrderStatus"
 */
function lambdaNameToToolName(fnName: string): string {
  // Strip common prefixes (stack name, env prefix)
  // e.g., "prod-myapp-processPayment" → "processPayment"
  const parts = fnName.split('-');

  // If last segment is already camelCase, use it
  const last = parts[parts.length - 1];
  if (last && /^[a-z]/.test(last) && /[A-Z]/.test(last)) {
    return last;
  }

  // Otherwise convert the whole thing
  // Strip known prefixes (dev-, staging-, prod-, etc.)
  let name = fnName.replace(/^(dev|staging|prod|test)[_-]/i, '');

  // Convert kebab-case or snake_case to camelCase
  name = name.replace(/[_-](\w)/g, (_, c) => c.toUpperCase());

  // Lowercase first char
  name = name.charAt(0).toLowerCase() + name.slice(1);

  return name;
}

/** Infer read-only from function name patterns */
function inferReadOnly(fnName: string): boolean {
  const lower = fnName.toLowerCase();
  const readPatterns = ['get', 'list', 'fetch', 'read', 'describe', 'query', 'search', 'find'];
  const writePatterns = ['create', 'update', 'delete', 'put', 'post', 'write', 'send', 'process', 'execute'];

  for (const p of writePatterns) {
    if (lower.includes(p)) return false;
  }
  for (const p of readPatterns) {
    if (lower.includes(p)) return true;
  }
  return true; // Default to read-only for safety
}

// ─── Lambda Invoker (used by server.ts) ──────────────────────────

/**
 * Build a function that invokes a Lambda function.
 * Called by server.ts when wiring up Lambda tool implementations.
 */
export async function buildLambdaInvoker(
  region: string,
  functionName: string,
): Promise<(params: Record<string, unknown>) => Promise<unknown>> {
  let LambdaClient: any;
  let InvokeCommand: any;

  try {
    // @ts-ignore — optional peer dependency
    const sdk = await import('@aws-sdk/client-lambda');
    LambdaClient = sdk.LambdaClient;
    InvokeCommand = sdk.InvokeCommand;
  } catch {
    throw new Error(
      'Lambda invocation requires @aws-sdk/client-lambda.\n' +
      'Install it: npm install @aws-sdk/client-lambda'
    );
  }

  const client = new LambdaClient({ region });

  return async (params: Record<string, unknown>) => {
    const response = await client.send(new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'RequestResponse',
      Payload: JSON.stringify(params),
    }));

    if (response.FunctionError) {
      const errorPayload = response.Payload
        ? JSON.parse(new TextDecoder().decode(response.Payload))
        : { errorMessage: response.FunctionError };
      throw new Error(errorPayload.errorMessage ?? 'Lambda invocation failed');
    }

    if (!response.Payload) return null;

    const result = JSON.parse(new TextDecoder().decode(response.Payload));

    // If the Lambda returns an API Gateway-style response, unwrap the body
    if (result.statusCode && result.body) {
      try {
        return JSON.parse(result.body);
      } catch {
        return result.body;
      }
    }

    return result;
  };
}

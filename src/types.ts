/** Core type definitions for codemode-x */

export interface ParameterDef {
  name: string;
  type: string; // TS type as string: "string", "number", "boolean", "{ beds: number; baths: number }[]"
  required: boolean;
  description?: string;
  default?: unknown;
}

export interface ToolDefinition {
  name: string;           // "getProperties"
  domain: string;         // "rentComps"
  description: string;
  parameters: ParameterDef[];
  returnType: string;     // TS type as string
  examples?: string[];
  auth?: { type: 'env'; mapping: Record<string, string> };
  readOnly: boolean;
  route?: string;         // Original route path for HTTP-based tools
  method?: string;        // HTTP method
  transport?: 'http' | 'lambda' | 'database'; // How to invoke this tool (default: http)
}

export interface ExecuteResult {
  success: boolean;
  result?: unknown;
  error?: string;
  logs: string[];
  durationMs: number;
}

export interface Executor {
  execute(
    code: string,
    fns: Record<string, Function>,
    opts?: { timeout?: number; memoryMB?: number }
  ): Promise<ExecuteResult>;
}

export interface Adapter {
  name: string;
  parse(source: unknown, opts?: AdapterOptions): Promise<ToolDefinition[]>;
}

export interface AdapterOptions {
  domain?: string;
  auth?: AuthConfig;
  baseUrl?: string;
}

export interface AuthConfig {
  provider?: { type: 'env'; mapping: Record<string, string> };
  scope: 'read' | 'readwrite';
}

export interface DomainConfig {
  name: string;
  adapter: string;
  source: string;
  auth?: AuthConfig;
  baseUrl?: string;
  options?: Record<string, unknown>; // Adapter-specific options
}

export interface CmxConfig {
  sdkName: string;
  domains: DomainConfig[];
  executor?: {
    timeout?: number;
    memoryMB?: number;
  };
}

export interface SearchResult {
  tool: ToolDefinition;
  score: number;
  typeSnippet: string; // Generated TS types for just this tool
}

/** Helper to define a config with type checking */
export function defineConfig(config: CmxConfig): CmxConfig {
  return config;
}

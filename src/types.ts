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
  transport?: 'http' | 'lambda' | 'database' | 'python' | 'mcp'; // How to invoke this tool (default: http)
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
  auth?: AuthConfig | HeaderAuthConfig;
  baseUrl?: string;
  writable?: boolean;
}

export interface AuthConfig {
  provider?: { type: 'env'; mapping: Record<string, string> };
  scope: 'read' | 'readwrite';
}

/** Simple header-based auth config for HTTP APIs */
export interface HeaderAuthConfig {
  type: 'header';
  key: string;      // Header name, e.g. 'X-API-Key'
  envVar: string;   // Environment variable name, e.g. 'MY_API_KEY'
}

export interface DomainConfig {
  name: string;
  adapter: string;
  source: string;
  auth?: AuthConfig | HeaderAuthConfig;
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

/** Type guard for scope-based auth config (has provider/scope fields) */
export function isScopeAuth(auth?: AuthConfig | HeaderAuthConfig): auth is AuthConfig {
  return !!auth && !('type' in auth);
}

/** Type guard for header-based auth config */
export function isHeaderAuth(auth?: AuthConfig | HeaderAuthConfig): auth is HeaderAuthConfig {
  return !!auth && 'type' in auth && (auth as HeaderAuthConfig).type === 'header';
}

/** Helper to define a config with type checking */
export function defineConfig(config: CmxConfig): CmxConfig {
  return config;
}

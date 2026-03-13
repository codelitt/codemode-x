import type { ToolDefinition } from './types.js';
import type { ToolRegistry } from './registry.js';
import { CredentialStore } from './auth.js';

export interface ProxyCallResult {
  toolName: string;
  domain: string;
  args: unknown[];
  result: unknown;
  durationMs: number;
}

type ToolImplementation = (args: Record<string, unknown>) => Promise<unknown>;

/**
 * Build the SDK proxy object that maps sdk.domain.method() calls
 * to actual tool implementations.
 */
export function buildSdkProxy(
  registry: ToolRegistry,
  implementations: Map<string, ToolImplementation>,
  credentials: CredentialStore,
  callLog: ProxyCallResult[]
): Record<string, Record<string, Function>> {
  const proxy: Record<string, Record<string, Function>> = {};

  for (const domain of registry.domains) {
    proxy[domain] = {};
    const tools = registry.getToolsByDomain(domain);

    for (const tool of tools) {
      const qualifiedName = `${domain}.${tool.name}`;
      const impl = implementations.get(qualifiedName);

      if (!impl) continue;

      proxy[domain][tool.name] = async (params: Record<string, unknown> = {}) => {
        const start = Date.now();

        // Inject credentials
        const creds = credentials.getCredentials(tool);
        const mergedParams = { ...params, ...creds };

        try {
          const result = await impl(mergedParams);
          callLog.push({
            toolName: tool.name,
            domain,
            args: [params],
            result,
            durationMs: Date.now() - start,
          });
          return result;
        } catch (err: any) {
          callLog.push({
            toolName: tool.name,
            domain,
            args: [params],
            result: { error: err.message },
            durationMs: Date.now() - start,
          });
          throw err;
        }
      };
    }
  }

  return proxy;
}

/**
 * Flatten the nested proxy into a flat function map for the executor.
 * sdk.rentComps.getProperties → { "rentComps.getProperties": fn }
 */
export function flattenProxy(
  proxy: Record<string, Record<string, Function>>
): Record<string, Function> {
  const flat: Record<string, Function> = {};
  for (const [domain, methods] of Object.entries(proxy)) {
    for (const [method, fn] of Object.entries(methods)) {
      flat[`${domain}.${method}`] = fn;
    }
  }
  return flat;
}

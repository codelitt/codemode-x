import type { ToolDefinition, AuthConfig } from './types.js';

/** Credential store — resolves auth configs to actual credentials at runtime */
export class CredentialStore {
  private envOverrides: Map<string, string> = new Map();

  /** Set an override (for testing) */
  setOverride(key: string, value: string): void {
    this.envOverrides.set(key, value);
  }

  /** Resolve a credential from env or override */
  private resolve(envKey: string): string | undefined {
    return this.envOverrides.get(envKey) ?? process.env[envKey];
  }

  /** Get credentials for a tool based on its auth config */
  getCredentials(tool: ToolDefinition): Record<string, string> {
    if (!tool.auth) return {};

    const creds: Record<string, string> = {};
    for (const [paramName, envKey] of Object.entries(tool.auth.mapping)) {
      const value = this.resolve(envKey);
      if (value) {
        creds[paramName] = value;
      }
    }
    return creds;
  }

  /** Check if a tool operation is allowed given its auth scope */
  checkScope(tool: ToolDefinition, domainAuth?: AuthConfig): boolean {
    if (tool.readOnly) return true; // Read ops always allowed
    if (!domainAuth) return true; // No auth config = allow all
    return domainAuth.scope === 'readwrite';
  }
}

/** Strip auth-related fields from tool definitions before sending to LLM */
export function sanitizeForLLM(tool: ToolDefinition): Omit<ToolDefinition, 'auth'> {
  const { auth, ...safe } = tool;
  return safe;
}

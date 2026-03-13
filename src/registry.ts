import type { ToolDefinition, Adapter, DomainConfig, AdapterOptions } from './types.js';

/** Central registry of all discovered tools across all domains */
export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private adapters: Map<string, Adapter> = new Map();

  registerAdapter(adapter: Adapter): void {
    this.adapters.set(adapter.name, adapter);
  }

  getAdapter(name: string): Adapter | undefined {
    return this.adapters.get(name);
  }

  /** Load tools from a domain config using its adapter */
  async loadDomain(domain: DomainConfig): Promise<number> {
    const adapter = this.adapters.get(domain.adapter);
    if (!adapter) {
      throw new Error(`No adapter registered for "${domain.adapter}". Available: ${[...this.adapters.keys()].join(', ')}`);
    }

    const opts: AdapterOptions = {
      domain: domain.name,
      auth: domain.auth,
      baseUrl: domain.baseUrl,
    };

    const defs = await adapter.parse(domain.source, opts);

    for (const def of defs) {
      def.domain = domain.name;
      const key = `${domain.name}.${def.name}`;
      this.tools.set(key, def);
    }

    return defs.length;
  }

  /** Get all registered tools */
  getAllTools(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  /** Get tools for a specific domain */
  getToolsByDomain(domain: string): ToolDefinition[] {
    return [...this.tools.values()].filter(t => t.domain === domain);
  }

  /** Get a specific tool by qualified name (domain.name) */
  getTool(qualifiedName: string): ToolDefinition | undefined {
    return this.tools.get(qualifiedName);
  }

  /** Get a tool by just its name (first match) */
  getToolByName(name: string): ToolDefinition | undefined {
    for (const tool of this.tools.values()) {
      if (tool.name === name) return tool;
    }
    return undefined;
  }

  /** Get count of registered tools */
  get size(): number {
    return this.tools.size;
  }

  /** Get all domain names */
  get domains(): string[] {
    return [...new Set([...this.tools.values()].map(t => t.domain))];
  }

  clear(): void {
    this.tools.clear();
  }
}

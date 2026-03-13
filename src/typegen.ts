import type { ToolDefinition, ParameterDef, SearchResult } from './types.js';

/** Generate TypeScript type string for a single tool's function signature */
export function generateToolTypes(tool: ToolDefinition): string {
  const params = tool.parameters.map(p => {
    const optional = p.required ? '' : '?';
    return `${p.name}${optional}: ${p.type}`;
  });

  const paramStr = params.length > 0
    ? `params: { ${params.join('; ')} }`
    : '';

  return `${tool.name}(${paramStr}): Promise<${tool.returnType}>`;
}

/** Generate the full SDK type declaration for a set of search results.
 *  Grouped by domain so Claude sees: sdk.rentComps.getProperties(...)
 */
export function generateSearchResultTypes(
  sdkName: string,
  results: SearchResult[]
): string {
  // Group by domain
  const byDomain = new Map<string, SearchResult[]>();
  for (const r of results) {
    const domain = r.tool.domain;
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain)!.push(r);
  }

  const lines: string[] = [];
  lines.push(`// Available SDK methods (use sdk.domain.method()):`)
  lines.push(`declare const sdk: {`);

  for (const [domain, domainResults] of byDomain) {
    lines.push(`  ${domain}: {`);
    for (const r of domainResults) {
      // Add description as JSDoc comment
      if (r.tool.description) {
        lines.push(`    /** ${r.tool.description} */`);
      }
      lines.push(`    ${r.typeSnippet};`);
    }
    lines.push(`  };`);
  }

  lines.push(`};`);
  return lines.join('\n');
}

/** Generate a compact summary for search results (for LLM consumption) */
export function formatSearchResults(
  sdkName: string,
  results: SearchResult[]
): string {
  if (results.length === 0) {
    return 'No matching tools found. Try different search terms.';
  }

  const sections: string[] = [];

  // Type declarations
  sections.push(generateSearchResultTypes(sdkName, results));

  // Brief descriptions with examples
  sections.push('');
  sections.push('// Tool details:');
  for (const r of results) {
    const params = r.tool.parameters
      .filter(p => p.required)
      .map(p => `${p.name}: ${p.type}`)
      .join(', ');

    const route = r.tool.route ? ` [${r.tool.method} ${r.tool.route}]` : '';
    const rw = r.tool.readOnly ? '' : ' [WRITE]';
    sections.push(`// - ${r.tool.domain}.${r.tool.name}${route}${rw}`);

    if (r.tool.examples?.length) {
      sections.push(`//   Example: ${r.tool.examples[0]}`);
    }
  }

  return sections.join('\n');
}

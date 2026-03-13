/**
 * CLAUDE.md routing instructions that tell Claude how to use codemode-x.
 * Can be auto-injected into a project's CLAUDE.md.
 */

export const CLAUDE_MD_SNIPPET = `
## codemode-x SDK

When working with APIs in this project, use the codemode-x MCP tools:

1. **Discover APIs**: Use \`cmx_search("your query")\` to find available SDK methods
2. **Execute code**: Use \`cmx_execute(code)\` to run TypeScript against the SDK

Example workflow:
\`\`\`
// Step 1: Search for what's available
cmx_search("properties rent data")

// Step 2: Write and execute code using the returned types
cmx_execute(\`
  const props = await sdk.rentComps.getProperties();
  console.log(props.length, "properties found");
  return props;
\`)
\`\`\`

Rules:
- Always search before executing to get current type signatures
- Use \`await\` for all SDK calls
- Use \`console.log()\` for intermediate output
- Use \`return\` for the final result
- Code runs in a sandbox — no fs, net, require, or import
`.trim();

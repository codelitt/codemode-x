import { defineConfig } from '../../src/types.js';

/**
 * Example: Express API + internal docs.
 *
 * Usage:
 *   1. Start your Express backend: node server.js
 *   2. Copy this file to your project root
 *   3. Run: npx codemode-x test
 */
export default defineConfig({
  sdkName: 'myapp',
  domains: [
    {
      name: 'api',
      adapter: 'express',
      source: './server.js',
      baseUrl: 'http://localhost:3001',
      auth: { scope: 'readwrite' },
    },
    // Uncomment to index docs as searchable knowledge:
    // {
    //   name: 'docs',
    //   adapter: 'markdown',
    //   source: './docs/**/*.md',
    // },
  ],
});

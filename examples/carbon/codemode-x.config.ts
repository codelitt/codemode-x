import { defineConfig } from '../../src/types.js';

/**
 * Carbon CREI config — rent comps Express API + internal docs.
 *
 * Usage:
 *   1. Start rent-comps backend: cd carbon-rent-comps/rent-comps-backend && node server.js
 *   2. Copy this file to your project root
 *   3. Run: npx codemode-x test
 */
export default defineConfig({
  sdkName: 'carbon',
  domains: [
    {
      name: 'rentComps',
      adapter: 'express',
      source: '../carbon-rent-comps/rent-comps-backend/server.js',
      baseUrl: 'http://localhost:3001',
      auth: { scope: 'readwrite' },
    },
    // Uncomment to index Carbon docs as searchable knowledge:
    // {
    //   name: 'docs',
    //   adapter: 'markdown',
    //   source: '../memory/**/*.md',
    // },
  ],
});

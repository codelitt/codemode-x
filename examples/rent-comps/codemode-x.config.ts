import { defineConfig } from '../../src/types.js';

/**
 * Example: Rent comps Express API.
 * Point source at your Express server file — codemode-x auto-discovers routes.
 */
export default defineConfig({
  sdkName: 'carbon',
  domains: [
    {
      name: 'rentComps',
      adapter: 'express',
      source: './server.js',
      baseUrl: 'http://localhost:3001',
      auth: { scope: 'readwrite' },
    },
    {
      name: 'docs',
      adapter: 'markdown',
      source: './docs/**/*.md',
    },
  ],
});

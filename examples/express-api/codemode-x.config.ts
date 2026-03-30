import { defineConfig } from '../../src/types.js';

/**
 * Example: Express API + markdown docs.
 * Point source at your Express server file — codemode-x auto-discovers routes.
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
    {
      name: 'docs',
      adapter: 'markdown',
      source: './docs/**/*.md',
    },
  ],
});

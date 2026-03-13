import { defineConfig } from './src/types.js';

/**
 * Example config — copy to your project root as codemode-x.config.ts
 * and customize for your APIs.
 */
export default defineConfig({
  sdkName: 'myapp',
  domains: [
    // Express app — auto-discovers routes via AST introspection
    {
      name: 'api',
      adapter: 'express',
      source: './server.js',
      baseUrl: 'http://localhost:3000',
      auth: { scope: 'readwrite' },
    },
    // OpenAPI spec — any Swagger/OpenAPI 3.x JSON file
    // {
    //   name: 'external',
    //   adapter: 'openapi',
    //   source: './openapi.json',
    //   baseUrl: 'https://api.example.com',
    //   auth: { scope: 'read' },
    // },
    // Markdown docs — indexed as searchable knowledge
    // {
    //   name: 'docs',
    //   adapter: 'markdown',
    //   source: './docs/**/*.md',
    // },
  ],
});

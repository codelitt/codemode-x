/**
 * Fixture config for CLI tests.
 * Express domain parses statically (no live server needed for search);
 * markdown domain executes locally, so exec tests need no network at all.
 */
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));

export default {
  sdkName: 'testsdk',
  domains: [
    {
      name: 'rentComps',
      adapter: 'express',
      source: resolve(here, 'sample-server.js'),
      baseUrl: 'http://localhost:3999',
    },
    {
      name: 'docs',
      adapter: 'markdown',
      source: resolve(here, 'sample-docs.md'),
    },
  ],
};

import { describe, it, expect, beforeAll } from 'vitest';
import { execSync, spawnSync } from 'child_process';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const CLI = resolve(ROOT, 'dist/src/cli.js');
const CONFIG = resolve(import.meta.dirname, 'fixtures/cli-config.mjs');
const SNIPPET = resolve(import.meta.dirname, 'fixtures/cli-snippet.js');

/** Run the built CLI as a subprocess (the real user-facing surface, including exit codes) */
function runCli(cliArgs: string[], stdin?: string) {
  const res = spawnSync('node', [CLI, ...cliArgs], {
    cwd: ROOT,
    input: stdin,
    encoding: 'utf-8',
    timeout: 60_000,
  });
  return { stdout: res.stdout ?? '', stderr: res.stderr ?? '', status: res.status };
}

// ─── CLI: search + exec ──────────────────────────────────────────

describe('CLI', () => {
  beforeAll(() => {
    // The CLI ships compiled; build once so the subprocess runs the real bin
    execSync('npm run build', { cwd: ROOT, stdio: 'ignore' });
  }, 120_000);

  describe('search', () => {
    it('returns a known tool with its TypeScript types', () => {
      const { stdout, status } = runCli(['search', 'properties', CONFIG]);
      expect(status).toBe(0);
      expect(stdout).toContain('getProperties');
      expect(stdout).toContain('Promise<');
      expect(stdout).toContain('declare const sdk');
    });

    it('exits non-zero without a query', () => {
      const { status, stderr } = runCli(['search']);
      expect(status).toBe(1);
      expect(stderr).toContain('Usage:');
    });
  });

  describe('exec', () => {
    it('runs a trivial snippet from a file and returns the expected value', () => {
      const { stdout, status } = runCli(['exec', SNIPPET, CONFIG]);
      expect(status).toBe(0);
      expect(stdout).toContain('--- Result ---');
      expect(stdout).toContain('42');
      expect(stdout).toMatch(/\(\d+ms, 0 API calls\)/);
    });

    it('reads code from stdin when the arg is -', () => {
      const { stdout, status } = runCli(['exec', '-', CONFIG], 'return 1 + 2;');
      expect(status).toBe(0);
      expect(stdout).toContain('--- Result ---');
      expect(stdout).toContain('3');
    });

    it('calls an SDK method end-to-end (markdown domain, no network)', () => {
      const { stdout, status } = runCli(
        ['exec', '-', CONFIG],
        `const doc = await sdk.docs.sample_docs_properties();
         return doc.slice(0, 30);`
      );
      expect(status).toBe(0);
      expect(stdout).toContain('--- Result ---');
      expect(stdout).toContain('Properties are the core entity');
      expect(stdout).toMatch(/\(\d+ms, 1 API calls\)/);
    });

    it('exits non-zero on a snippet that throws, with the error on stderr', () => {
      const { stdout, stderr, status } = runCli(['exec', '-', CONFIG], 'throw new Error("boom");');
      expect(status).toBe(1);
      expect(stderr).toContain('--- Error ---');
      expect(stderr).toContain('boom');
      expect(stdout).not.toContain('boom');
    });
  });
});

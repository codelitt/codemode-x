import vm from 'node:vm';
import type { ExecuteResult, Executor } from './types.js';
import { validateCode } from './parser.js';

const DEFAULT_TIMEOUT = 30_000;

/**
 * VM-based executor using Node's built-in vm module.
 * Runs user code in a separate V8 context with no access to Node globals.
 * SDK functions are injected as the only bridge to the outside world.
 *
 * For production hardening, swap in an isolated-vm or Docker-based executor.
 */
export class SandboxExecutor implements Executor {
  async execute(
    code: string,
    fns: Record<string, Function>,
    opts?: { timeout?: number; memoryMB?: number }
  ): Promise<ExecuteResult> {
    const start = Date.now();
    const logs: string[] = [];
    const timeout = opts?.timeout ?? DEFAULT_TIMEOUT;

    // Step 1: AST validation (blocks require, import, fetch, process, eval, etc.)
    const validation = validateCode(code);
    if (!validation.valid) {
      return {
        success: false,
        error: `Code validation failed:\n${validation.errors.join('\n')}`,
        logs,
        durationMs: Date.now() - start,
      };
    }

    // Step 2: Build the SDK object structure inside the sandbox
    const sdkProxy = buildSdkObject(fns);

    // Step 3: Create a locked-down VM context
    const consoleFns = {
      log: (...args: any[]) => logs.push(args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')),
      error: (...args: any[]) => logs.push('ERROR: ' + args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')),
      warn: (...args: any[]) => logs.push('WARN: ' + args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')),
    };

    const sandbox = {
      sdk: sdkProxy,
      console: consoleFns,
      // Provide standard JS globals but nothing Node-specific
      JSON,
      Math,
      Date,
      Array,
      Object,
      String,
      Number,
      Boolean,
      RegExp,
      Map,
      Set,
      WeakMap,
      WeakSet,
      Promise,
      Symbol,
      Error,
      TypeError,
      RangeError,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      encodeURIComponent,
      decodeURIComponent,
      encodeURI,
      decodeURI,
      undefined,
      NaN,
      Infinity,
      // Explicitly block dangerous globals
      require: undefined,
      process: undefined,
      globalThis: undefined,
      global: undefined,
      fetch: undefined,
      __dirname: undefined,
      __filename: undefined,
    };

    const context = vm.createContext(sandbox, {
      name: 'cmx-sandbox',
      codeGeneration: { strings: false, wasm: false },
    });

    try {
      // Wrap user code in an async IIFE so await works at top level
      const wrappedCode = `(async () => {\n${code}\n})()`;

      const script = new vm.Script(wrappedCode, {
        filename: 'cmx-execute.js',
      });

      const resultPromise = script.runInContext(context, { timeout });

      // The result is a promise from the async IIFE
      const rawResult = await resultPromise;

      return {
        success: true,
        result: rawResult,
        logs,
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      const isTimeout = err.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT';
      return {
        success: false,
        error: isTimeout ? `Execution timed out after ${timeout}ms` : err.message,
        logs,
        durationMs: Date.now() - start,
      };
    }
  }
}

/**
 * Build a nested sdk.domain.method() object from the flat function map.
 * Input: { "rentComps.getProperties": fn, "rentComps.getComps": fn }
 * Output: { rentComps: { getProperties: fn, getComps: fn } }
 */
function buildSdkObject(fns: Record<string, Function>): Record<string, Record<string, Function>> {
  const sdk: Record<string, Record<string, Function>> = {};

  for (const [qualifiedName, fn] of Object.entries(fns)) {
    const dotIdx = qualifiedName.indexOf('.');
    if (dotIdx === -1) continue;

    const domain = qualifiedName.slice(0, dotIdx);
    const method = qualifiedName.slice(dotIdx + 1);

    if (!sdk[domain]) sdk[domain] = {};
    sdk[domain][method] = fn;
  }

  return sdk;
}

/**
 * Direct executor — runs code in the current Node process.
 * No sandbox. Use only for testing.
 */
export class DirectExecutor implements Executor {
  async execute(
    code: string,
    fns: Record<string, Function>,
    _opts?: { timeout?: number }
  ): Promise<ExecuteResult> {
    const start = Date.now();
    const logs: string[] = [];

    const validation = validateCode(code);
    if (!validation.valid) {
      return {
        success: false,
        error: `Code validation failed:\n${validation.errors.join('\n')}`,
        logs,
        durationMs: Date.now() - start,
      };
    }

    const sdk = buildSdkObject(fns);
    const console = {
      log: (...args: any[]) => logs.push(args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')),
      error: (...args: any[]) => logs.push('ERROR: ' + args.join(' ')),
      warn: (...args: any[]) => logs.push('WARN: ' + args.join(' ')),
    };

    try {
      const asyncFn = new Function('sdk', 'console', `return (async () => { ${code} })()`);
      const result = await asyncFn(sdk, console);

      return { success: true, result, logs, durationMs: Date.now() - start };
    } catch (err: any) {
      return { success: false, error: err.message, logs, durationMs: Date.now() - start };
    }
  }
}

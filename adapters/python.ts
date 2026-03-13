import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve, basename } from 'path';
import type { Adapter, ToolDefinition, AdapterOptions, ParameterDef } from '../src/types.js';

/**
 * Python adapter — introspects Python modules via subprocess to extract
 * function signatures as ToolDefinitions.
 *
 * Source: path to a Python file or module directory
 * Options (via DomainConfig.options):
 *   - python: string        — path to Python interpreter (default: "python3")
 *   - functions: string[]   — only include these functions
 *   - exclude: string[]     — exclude these functions
 *
 * For each public function in the module, generates a tool with typed parameters
 * derived from Python type hints and docstrings.
 */
export const pythonAdapter: Adapter = {
  name: 'python',

  async parse(source: unknown, opts?: AdapterOptions): Promise<ToolDefinition[]> {
    const sourcePath = resolve(String(source));
    const domain = opts?.domain ?? 'python';

    if (!existsSync(sourcePath)) {
      throw new Error(`Python source not found: ${sourcePath}`);
    }

    const options = (opts as any) ?? {};
    const pythonBin: string = options.python ?? 'python3';
    const includeFns: string[] | undefined = options.functions;
    const excludeFns: string[] | undefined = options.exclude;

    // Run introspection script via subprocess
    const introspectScript = buildIntrospectScript(sourcePath);
    let rawOutput: string;

    try {
      rawOutput = execSync(`${pythonBin} -c ${escapeShellArg(introspectScript)}`, {
        encoding: 'utf-8',
        timeout: 15_000,
        cwd: resolve(sourcePath, '..'),
      });
    } catch (err: any) {
      throw new Error(
        `Failed to introspect Python module at ${sourcePath}:\n${err.stderr ?? err.message}`
      );
    }

    let functions: PythonFunctionInfo[];
    try {
      functions = JSON.parse(rawOutput);
    } catch {
      throw new Error(`Failed to parse Python introspection output:\n${rawOutput.slice(0, 500)}`);
    }

    const tools: ToolDefinition[] = [];

    for (const fn of functions) {
      // Apply include/exclude filters
      if (includeFns && !includeFns.includes(fn.name)) continue;
      if (excludeFns && excludeFns.includes(fn.name)) continue;

      const parameters: ParameterDef[] = fn.params.map(p => ({
        name: p.name,
        type: mapPythonType(p.type),
        required: !p.has_default,
        description: p.description,
        default: p.default_value,
      }));

      tools.push({
        name: fn.name,
        domain,
        description: fn.docstring || `Call Python function: ${fn.name}`,
        parameters,
        returnType: mapPythonType(fn.return_type),
        readOnly: inferReadOnly(fn.name),
        transport: 'python',
        method: 'CALL',
        route: fn.qualified_name, // Full module.function path
      });
    }

    return tools;
  },
};

// ─── Python Introspection Script ────────────────────────────────

interface PythonFunctionInfo {
  name: string;
  qualified_name: string;
  docstring: string;
  params: PythonParamInfo[];
  return_type: string;
}

interface PythonParamInfo {
  name: string;
  type: string;
  has_default: boolean;
  default_value?: unknown;
  description?: string;
}

/**
 * Build a Python script that introspects a module and outputs JSON
 * describing all public functions with their signatures.
 */
function buildIntrospectScript(sourcePath: string): string {
  const modulePath = sourcePath.replace(/\\/g, '/');

  return `
import sys, json, inspect, importlib.util, os, re

# Load the module from file path
spec = importlib.util.spec_from_file_location("_cmx_target", "${modulePath}")
if spec is None or spec.loader is None:
    print("[]")
    sys.exit(0)

mod = importlib.util.module_from_spec(spec)
try:
    spec.loader.exec_module(mod)
except Exception as e:
    print(json.dumps([]))
    sys.exit(0)

def get_type_str(annotation):
    if annotation is inspect.Parameter.empty:
        return "any"
    if hasattr(annotation, "__name__"):
        return annotation.__name__
    return str(annotation).replace("typing.", "")

def parse_docstring_params(docstring):
    """Extract parameter descriptions from docstring."""
    params = {}
    if not docstring:
        return params
    # Match :param name: description or Args:\\n    name: description
    for match in re.finditer(r':param\\s+(\\w+):\\s*(.+?)(?=\\n|$)', docstring):
        params[match.group(1)] = match.group(2).strip()
    # Google-style Args section
    args_match = re.search(r'Args:\\s*\\n((?:\\s+\\w+.*\\n?)+)', docstring)
    if args_match:
        for line in args_match.group(1).strip().split('\\n'):
            line = line.strip()
            if ':' in line:
                name, desc = line.split(':', 1)
                name = name.strip().split('(')[0].strip()
                params[name] = desc.strip()
    return params

results = []

for name, obj in inspect.getmembers(mod, inspect.isfunction):
    # Skip private/internal functions
    if name.startswith('_'):
        continue

    # Only include functions defined in this module
    if obj.__module__ != "_cmx_target":
        continue

    sig = inspect.signature(obj)
    docstring = inspect.getdoc(obj) or ""
    doc_params = parse_docstring_params(docstring)
    # Clean docstring: first line only for description
    desc = docstring.split('\\n')[0].strip() if docstring else ""

    params = []
    for pname, param in sig.parameters.items():
        if pname in ('self', 'cls'):
            continue
        p = {
            "name": pname,
            "type": get_type_str(param.annotation),
            "has_default": param.default is not inspect.Parameter.empty,
        }
        if p["has_default"]:
            try:
                json.dumps(param.default)
                p["default_value"] = param.default
            except (TypeError, ValueError):
                p["default_value"] = str(param.default)
        if pname in doc_params:
            p["description"] = doc_params[pname]
        params.append(p)

    return_type = get_type_str(sig.return_annotation)

    results.append({
        "name": name,
        "qualified_name": f"${modulePath}::{name}",
        "docstring": desc,
        "params": params,
        "return_type": return_type,
    })

print(json.dumps(results))
`;
}

// ─── Python Invoker (used by server.ts) ──────────────────────────

type ToolImplementation = (args: Record<string, unknown>) => Promise<unknown>;

/**
 * Build a function that invokes a Python function via subprocess.
 * The function receives JSON on stdin and prints JSON to stdout.
 */
export function buildPythonInvoker(
  sourcePath: string,
  functionName: string,
  pythonBin: string = 'python3',
): ToolImplementation {
  const modulePath = resolve(sourcePath).replace(/\\/g, '/');
  const fnName = functionName.split('::').pop()!;

  return async (params: Record<string, unknown>) => {
    const invokeScript = `
import sys, json, importlib.util

spec = importlib.util.spec_from_file_location("_cmx_target", "${modulePath}")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

params = json.loads(sys.stdin.read())
result = getattr(mod, "${fnName}")(**params)

# Handle common return types
if hasattr(result, '__dict__'):
    result = result.__dict__
print(json.dumps(result))
`;

    try {
      const output = execSync(`${pythonBin} -c ${escapeShellArg(invokeScript)}`, {
        input: JSON.stringify(params),
        encoding: 'utf-8',
        timeout: 30_000,
        cwd: resolve(sourcePath, '..'),
      });
      return JSON.parse(output.trim());
    } catch (err: any) {
      throw new Error(`Python function ${fnName} failed: ${err.stderr ?? err.message}`);
    }
  };
}

// ─── Helpers ─────────────────────────────────────────────────────

/** Map Python type annotations to TypeScript types */
function mapPythonType(pyType: string): string {
  if (!pyType || pyType === 'any') return 'unknown';

  const typeMap: Record<string, string> = {
    str: 'string',
    int: 'number',
    float: 'number',
    bool: 'boolean',
    None: 'void',
    NoneType: 'void',
    dict: 'Record<string, unknown>',
    list: 'unknown[]',
    tuple: 'unknown[]',
    set: 'unknown[]',
    bytes: 'string',
  };

  // Direct match
  if (typeMap[pyType]) return typeMap[pyType];

  // Handle List[X], Dict[K,V], Optional[X], etc.
  const listMatch = pyType.match(/^[Ll]ist\[(.+)]$/);
  if (listMatch) return `${mapPythonType(listMatch[1])}[]`;

  const optionalMatch = pyType.match(/^Optional\[(.+)]$/);
  if (optionalMatch) return `${mapPythonType(optionalMatch[1])} | null`;

  const dictMatch = pyType.match(/^[Dd]ict\[(.+),\s*(.+)]$/);
  if (dictMatch) return `Record<${mapPythonType(dictMatch[1])}, ${mapPythonType(dictMatch[2])}>`;

  const unionMatch = pyType.match(/^Union\[(.+)]$/);
  if (unionMatch) {
    return unionMatch[1].split(',').map(t => mapPythonType(t.trim())).join(' | ');
  }

  return 'unknown';
}

/** Infer read-only from function name */
function inferReadOnly(fnName: string): boolean {
  const lower = fnName.toLowerCase();
  const writePatterns = ['create', 'update', 'delete', 'write', 'send', 'post', 'put', 'save', 'remove', 'insert', 'modify', 'set'];
  for (const p of writePatterns) {
    if (lower.includes(p)) return false;
  }
  return true;
}

/** Escape a string for shell argument */
function escapeShellArg(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

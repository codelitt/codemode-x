# Python Adapter

Introspect Python modules and expose their functions as typed SDK methods. Functions are called via subprocess — no shared runtime, no import conflicts.

## Configuration

```js
export default {
  sdkName: 'myapp',
  domains: [
    {
      name: 'analytics',
      adapter: 'python',
      source: './lib/analytics.py',
      options: {
        python: 'python3',            // path to interpreter (default: python3)
        functions: ['run_report'],     // optional: only include these
        // exclude: ['internal_fn'],   // or: exclude these
      },
    },
  ],
};
```

## How it works

### Discovery

The adapter runs a Python introspection script via subprocess that:

1. Loads the module using `importlib`
2. Iterates public functions (skips `_private` names)
3. Extracts signatures via `inspect.signature()`
4. Parses type hints and docstrings
5. Outputs JSON describing all functions

### Execution

When Claude calls a Python function via `cmx_execute`, codemode-x:

1. Serializes the arguments as JSON
2. Spawns a subprocess: `python3 -c <invoke_script>`
3. Pipes the JSON params to stdin
4. Parses the JSON result from stdout

Each call is a fresh subprocess — no shared state between calls.

## Type Mapping

Python type hints are mapped to TypeScript types:

| Python Type | TypeScript Type |
|-------------|-----------------|
| `str` | `string` |
| `int`, `float` | `number` |
| `bool` | `boolean` |
| `None` | `void` |
| `dict` | `Record<string, unknown>` |
| `list` | `unknown[]` |
| `List[X]` | `X[]` |
| `Dict[K, V]` | `Record<K, V>` |
| `Optional[X]` | `X \| null` |
| `Union[X, Y]` | `X \| Y` |
| `tuple`, `set` | `unknown[]` |
| `bytes` | `string` |

Functions without type hints show up as `unknown` types — they still work, just without type safety.

## Docstring Parsing

The adapter extracts parameter descriptions from docstrings. Both styles are supported:

### Google style

```python
def get_users(limit: int = 10) -> List[dict]:
    """Fetch users from the database.

    Args:
        limit: Maximum number of users to return
    """
```

### Sphinx/reST style

```python
def get_users(limit: int = 10) -> List[dict]:
    """Fetch users from the database.

    :param limit: Maximum number of users to return
    """
```

The first line of the docstring becomes the tool description.

## Function Filtering

```js
// Only expose specific functions
options: { functions: ['get_users', 'run_report'] }

// Expose everything except these
options: { exclude: ['debug_dump', 'test_helper'] }
```

Private functions (starting with `_`) are always excluded.

## Read-Only Inference

Functions are inferred as read-only unless their name contains write-indicating patterns: `create`, `update`, `delete`, `write`, `send`, `save`, `remove`, `insert`, `modify`, `set`.

## Requirements

- Python 3.6+ with type hints support
- The module must be importable (dependencies installed in the Python environment)
- No extra Python packages required for introspection — uses only stdlib (`inspect`, `importlib`, `json`)

## Custom Python Interpreter

Point to a specific Python environment:

```js
options: {
  python: '/path/to/venv/bin/python',
}
```

This is useful when your module has dependencies installed in a virtualenv.

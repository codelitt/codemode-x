import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

/** Blocked global identifiers that code must not reference */
const BLOCKED_GLOBALS = new Set([
  'require', 'import', 'fetch', 'XMLHttpRequest',
  'process', 'child_process', 'fs', 'net', 'http', 'https',
  'dgram', 'cluster', 'worker_threads',
  '__dirname', '__filename',
  'eval', 'Function',
]);

/** Blocked member access patterns */
const BLOCKED_MEMBERS = new Set([
  'globalThis.process',
  'globalThis.require',
  'globalThis.fetch',
]);

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  ast?: acorn.Node;
}

/** Validate TypeScript/JavaScript code for sandbox safety via AST analysis */
export function validateCode(code: string): ValidationResult {
  const errors: string[] = [];

  let ast: acorn.Node;
  try {
    ast = acorn.parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
    });
  } catch (e: any) {
    return { valid: false, errors: [`Parse error: ${e.message}`] };
  }

  // Track identifiers that appear as property names (not globals)
  const propertyNames = new Set<acorn.Node>();
  walk.simple(ast, {
    MemberExpression(node: any) {
      if (!node.computed) propertyNames.add(node.property);
    },
  });

  // Walk AST looking for forbidden patterns
  walk.simple(ast, {
    Identifier(node: any) {
      // Skip property access like obj.process — only flag bare globals
      if (propertyNames.has(node)) return;
      if (BLOCKED_GLOBALS.has(node.name)) {
        errors.push(`Blocked global: "${node.name}" is not allowed in sandbox code`);
      }
    },

    ImportDeclaration(_node: any) {
      errors.push('Import declarations are not allowed in sandbox code');
    },

    ImportExpression(_node: any) {
      errors.push('Dynamic import() is not allowed in sandbox code');
    },

    MemberExpression(node: any) {
      // Check for globalThis.process etc
      if (node.object?.name === 'globalThis' && node.property?.name) {
        const full = `globalThis.${node.property.name}`;
        if (BLOCKED_MEMBERS.has(full)) {
          errors.push(`Blocked access: "${full}" is not allowed in sandbox code`);
        }
      }
    },

    CallExpression(node: any) {
      // Block new Function()
      if (node.callee?.type === 'NewExpression' && node.callee.callee?.name === 'Function') {
        errors.push('new Function() is not allowed in sandbox code');
      }
    },

    NewExpression(node: any) {
      if (node.callee?.name === 'Function') {
        errors.push('new Function() is not allowed in sandbox code');
      }
    },
  });

  return { valid: errors.length === 0, errors, ast };
}

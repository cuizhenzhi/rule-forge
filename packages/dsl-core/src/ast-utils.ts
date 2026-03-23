import type { ExprNode, PredicateNode, AstComplexity } from './types.js';

/**
 * Convert an AST node to a human-readable text representation.
 * This is a derived view, not a formal DSL representation.
 */
export function astToText(node: ExprNode): string {
  switch (node.node_type) {
    case 'predicate':
      return predicateToText(node);
    case 'and':
      return `(${node.children.map(astToText).join(' AND ')})`;
    case 'or':
      return `(${node.children.map(astToText).join(' OR ')})`;
    case 'not':
      return `NOT ${astToText(node.child)}`;
  }
}

function predicateToText(node: PredicateNode): string {
  const valueStr = formatValue(node.operator, node.value);
  return `[${node.field} ${node.operator} ${valueStr}]`;
}

function formatValue(operator: string, value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (operator === 'regex') return `/${value}/`;
  if (Array.isArray(value)) {
    const items = value.map((v) => typeof v === 'string' ? `"${v}"` : String(v));
    if (items.length > 5) return `[${items.slice(0, 5).join(', ')}, ... +${items.length - 5}]`;
    return `[${items.join(', ')}]`;
  }
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'string') return `"${value}"`;
  return String(value);
}

/**
 * Calculate AST complexity metrics.
 */
export function astComplexity(node: ExprNode): AstComplexity {
  let nodeCount = 0;
  let predicateCount = 0;

  function walk(n: ExprNode, depth: number): number {
    nodeCount++;
    let maxChildDepth = depth;

    switch (n.node_type) {
      case 'predicate':
        predicateCount++;
        break;
      case 'and':
      case 'or':
        for (const child of n.children) {
          maxChildDepth = Math.max(maxChildDepth, walk(child, depth + 1));
        }
        break;
      case 'not':
        maxChildDepth = Math.max(maxChildDepth, walk(n.child, depth + 1));
        break;
    }
    return maxChildDepth;
  }

  const depth = walk(node, 1);

  return { nodeCount, depth, predicateCount };
}

/**
 * Collect all node IDs in the AST for uniqueness checking.
 */
export function collectNodeIds(node: ExprNode): string[] {
  const ids: string[] = [];

  function walk(n: ExprNode): void {
    ids.push(n.id);
    switch (n.node_type) {
      case 'and':
      case 'or':
        n.children.forEach(walk);
        break;
      case 'not':
        walk(n.child);
        break;
    }
  }

  walk(node);
  return ids;
}

/**
 * Generate a short summary of the rule for list views.
 */
export function astToSummary(node: ExprNode, maxLen = 80): string {
  const full = astToText(node);
  if (full.length <= maxLen) return full;
  return full.slice(0, maxLen - 3) + '...';
}

import { describe, it, expect } from 'vitest';
import { astToText, astComplexity, collectNodeIds, astToSummary } from '../ast-utils.js';
import type { ExprNode } from '../types.js';

const simpleNode: ExprNode = {
  node_type: 'predicate',
  id: 'c1',
  field: 'content',
  operator: 'contains_any',
  value: ['傻X', '垃圾'],
};

const complexNode: ExprNode = {
  node_type: 'and',
  id: 'n_root',
  children: [
    {
      node_type: 'or',
      id: 'n_or',
      children: [
        { node_type: 'predicate', id: 'c1', field: 'content', operator: 'contains_any', value: ['bad'] },
        { node_type: 'predicate', id: 'c2', field: 'content', operator: 'regex', value: '(threat)' },
      ],
    },
    {
      node_type: 'not',
      id: 'n_not',
      child: { node_type: 'predicate', id: 'c3', field: 'author_id', operator: 'in_set', value: ['u1'] },
    },
  ],
};

describe('astToText', () => {
  it('formats simple predicate', () => {
    expect(astToText(simpleNode)).toBe('[content contains_any ["傻X", "垃圾"]]');
  });

  it('formats complex AST', () => {
    const text = astToText(complexNode);
    expect(text).toContain('AND');
    expect(text).toContain('OR');
    expect(text).toContain('NOT');
  });

  it('formats regex value', () => {
    const node: ExprNode = { node_type: 'predicate', id: 'c1', field: 'content', operator: 'regex', value: '(test)' };
    expect(astToText(node)).toBe('[content regex /(test)/]');
  });

  it('formats count_gt value', () => {
    const node: ExprNode = { node_type: 'predicate', id: 'c1', field: 'content', operator: 'count_gt', value: { target: '!', threshold: 3 } };
    expect(astToText(node)).toContain('count_gt');
  });
});

describe('astComplexity', () => {
  it('counts simple predicate', () => {
    const c = astComplexity(simpleNode);
    expect(c.nodeCount).toBe(1);
    expect(c.depth).toBe(1);
    expect(c.predicateCount).toBe(1);
  });

  it('counts complex tree', () => {
    const c = astComplexity(complexNode);
    expect(c.nodeCount).toBe(6);
    expect(c.predicateCount).toBe(3);
    expect(c.depth).toBe(3);
  });
});

describe('collectNodeIds', () => {
  it('collects all ids', () => {
    const ids = collectNodeIds(complexNode);
    expect(ids).toEqual(['n_root', 'n_or', 'c1', 'c2', 'n_not', 'c3']);
  });
});

describe('astToSummary', () => {
  it('returns full text for short rules', () => {
    expect(astToSummary(simpleNode)).toBe(astToText(simpleNode));
  });

  it('truncates long rules', () => {
    const summary = astToSummary(complexNode, 30);
    expect(summary.length).toBeLessThanOrEqual(30);
    expect(summary.endsWith('...')).toBe(true);
  });
});

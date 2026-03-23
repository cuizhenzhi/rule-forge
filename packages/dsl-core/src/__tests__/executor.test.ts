import { describe, it, expect } from 'vitest';
import { executeRule } from '../executor.js';
import type { RuleDSL } from '../types.js';

const makeDsl = (root: RuleDSL['root']): RuleDSL => ({
  dsl_version: '1.0',
  rule_id: 'R_TEST',
  name: 'Test',
  root,
  action: { type: 'block', severity: 'high' },
  semantics: { mode: 'boolean' },
});

describe('Executor - predicate nodes', () => {
  it('contains_any hits', () => {
    const dsl = makeDsl({ node_type: 'predicate', id: 'c1', field: 'content', operator: 'contains_any', value: ['傻X', '垃圾'] });
    const result = executeRule(dsl, { content: '你就是垃圾' }, 'S1');
    expect(result.final_hit).toBe(true);
    expect(result.trace.status).toBe('evaluated');
    expect(result.trace.evidence?.matched_text).toBe('垃圾');
  });

  it('contains_any misses', () => {
    const dsl = makeDsl({ node_type: 'predicate', id: 'c1', field: 'content', operator: 'contains_any', value: ['傻X'] });
    const result = executeRule(dsl, { content: '你好世界' }, 'S2');
    expect(result.final_hit).toBe(false);
  });

  it('regex hits', () => {
    const dsl = makeDsl({ node_type: 'predicate', id: 'c1', field: 'content', operator: 'regex', value: '(弄死你|杀了你)' });
    const result = executeRule(dsl, { content: '我要弄死你' }, 'S3');
    expect(result.final_hit).toBe(true);
    expect(result.trace.evidence?.matched_text).toBe('弄死你');
  });

  it('len_gt works', () => {
    const dsl = makeDsl({ node_type: 'predicate', id: 'c1', field: 'content', operator: 'len_gt', value: 5 });
    const hit = executeRule(dsl, { content: '这是一段很长的文本' }, 'S4');
    expect(hit.final_hit).toBe(true);
    const miss = executeRule(dsl, { content: '短' }, 'S5');
    expect(miss.final_hit).toBe(false);
  });

  it('count_gt works', () => {
    const dsl = makeDsl({ node_type: 'predicate', id: 'c1', field: 'content', operator: 'count_gt', value: { target: '!', threshold: 3 } });
    const result = executeRule(dsl, { content: '你好!你好!你好!你好!' }, 'S6');
    expect(result.final_hit).toBe(true);
    expect(result.trace.evidence?.count).toBe(4);
  });

  it('in_set works', () => {
    const dsl = makeDsl({ node_type: 'predicate', id: 'c1', field: 'author_id', operator: 'in_set', value: ['u1', 'u2'] });
    expect(executeRule(dsl, { author_id: 'u1' }).final_hit).toBe(true);
    expect(executeRule(dsl, { author_id: 'u3' }).final_hit).toBe(false);
  });
});

describe('Executor - logic nodes', () => {
  it('AND requires all true', () => {
    const dsl = makeDsl({
      node_type: 'and', id: 'n1', children: [
        { node_type: 'predicate', id: 'c1', field: 'content', operator: 'contains_any', value: ['bad'] },
        { node_type: 'predicate', id: 'c2', field: 'content', operator: 'len_gt', value: 3 },
      ],
    });
    const result = executeRule(dsl, { content: 'this is bad' });
    expect(result.final_hit).toBe(true);
  });

  it('AND short-circuits on first false', () => {
    const dsl = makeDsl({
      node_type: 'and', id: 'n1', children: [
        { node_type: 'predicate', id: 'c1', field: 'content', operator: 'contains_any', value: ['missing'] },
        { node_type: 'predicate', id: 'c2', field: 'content', operator: 'len_gt', value: 3 },
      ],
    });
    const result = executeRule(dsl, { content: 'hello world' });
    expect(result.final_hit).toBe(false);
    expect(result.trace.children![0].status).toBe('evaluated');
    expect(result.trace.children![0].result).toBe(false);
    expect(result.trace.children![1].status).toBe('skipped');
    expect(result.trace.children![1].result).toBeNull();
  });

  it('OR short-circuits on first true', () => {
    const dsl = makeDsl({
      node_type: 'or', id: 'n1', children: [
        { node_type: 'predicate', id: 'c1', field: 'content', operator: 'contains_any', value: ['hello'] },
        { node_type: 'predicate', id: 'c2', field: 'content', operator: 'contains_any', value: ['world'] },
      ],
    });
    const result = executeRule(dsl, { content: 'hello world' });
    expect(result.final_hit).toBe(true);
    expect(result.trace.children![0].status).toBe('evaluated');
    expect(result.trace.children![0].result).toBe(true);
    expect(result.trace.children![1].status).toBe('skipped');
    expect(result.trace.children![1].result).toBeNull();
  });

  it('NOT negates child', () => {
    const dsl = makeDsl({
      node_type: 'not', id: 'n1',
      child: { node_type: 'predicate', id: 'c1', field: 'author_id', operator: 'in_set', value: ['banned_user'] },
    });
    expect(executeRule(dsl, { author_id: 'normal_user' }).final_hit).toBe(true);
    expect(executeRule(dsl, { author_id: 'banned_user' }).final_hit).toBe(false);
  });
});

describe('Executor - trace structure', () => {
  it('returns correct rule_id and sample_id', () => {
    const dsl = makeDsl({ node_type: 'predicate', id: 'c1', field: 'content', operator: 'contains_any', value: ['x'] });
    const result = executeRule(dsl, { content: 'x' }, 'SAMPLE_42');
    expect(result.rule_id).toBe('R_TEST');
    expect(result.sample_id).toBe('SAMPLE_42');
    expect(result.action.type).toBe('block');
  });

  it('deeply nested skipped traces preserve structure', () => {
    const dsl = makeDsl({
      node_type: 'and', id: 'n_root', children: [
        { node_type: 'predicate', id: 'c1', field: 'content', operator: 'contains_any', value: ['never_match'] },
        {
          node_type: 'or', id: 'n_or', children: [
            { node_type: 'predicate', id: 'c2', field: 'content', operator: 'contains_any', value: ['a'] },
            { node_type: 'predicate', id: 'c3', field: 'content', operator: 'contains_any', value: ['b'] },
          ],
        },
      ],
    });
    const result = executeRule(dsl, { content: 'hello' });
    expect(result.final_hit).toBe(false);
    const orTrace = result.trace.children![1];
    expect(orTrace.status).toBe('skipped');
    expect(orTrace.children![0].status).toBe('skipped');
    expect(orTrace.children![1].status).toBe('skipped');
  });
});

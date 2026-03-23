import { describe, it, expect } from 'vitest';
import { validateDsl, validateL1, validateL2 } from '../validator.js';
import type { FieldDictEntry, OperatorName, RuleDSL } from '../types.js';

const fieldDict: FieldDictEntry[] = [
  { field: 'content', type: 'string', source: 'raw' },
  { field: 'content_norm', type: 'string', source: 'preprocessing' },
  { field: 'title', type: 'string', source: 'raw' },
  { field: 'author_id', type: 'string', source: 'raw' },
];

const opWhitelist: OperatorName[] = [
  'contains_any', 'regex', 'len_gt', 'len_lt', 'in_set', 'not_in_set', 'count_gt',
];

const validDsl: RuleDSL = {
  dsl_version: '1.0',
  rule_id: 'R_001',
  name: 'Test Rule',
  root: {
    node_type: 'predicate',
    id: 'c1',
    field: 'content',
    operator: 'contains_any',
    value: ['bad_word'],
  },
  action: { type: 'block', severity: 'high' },
  semantics: { mode: 'boolean' },
};

describe('L1 - JSON Parseable', () => {
  it('rejects invalid JSON', () => {
    const result = validateL1('{bad json');
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('JSON_PARSE_ERROR');
  });

  it('rejects arrays', () => {
    const result = validateL1('[]');
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('NOT_OBJECT');
  });

  it('rejects missing required fields', () => {
    const result = validateL1('{"dsl_version": "1.0"}');
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.code === 'MISSING_FIELD')).toBe(true);
  });

  it('passes valid JSON with all required fields', () => {
    const result = validateL1(JSON.stringify(validDsl));
    expect(result.ok).toBe(true);
  });
});

describe('L2 - Schema Valid', () => {
  it('rejects wrong dsl_version', () => {
    const result = validateL2({ ...validDsl, dsl_version: '2.0' }, fieldDict, opWhitelist);
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('INVALID_VERSION');
  });

  it('rejects unknown field', () => {
    const dsl = {
      ...validDsl,
      root: { node_type: 'predicate', id: 'c1', field: 'unknown_field', operator: 'contains_any', value: ['x'] },
    };
    const result = validateL2(dsl, fieldDict, opWhitelist);
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('UNKNOWN_FIELD');
  });

  it('rejects unknown operator', () => {
    const dsl = {
      ...validDsl,
      root: { node_type: 'predicate', id: 'c1', field: 'content', operator: 'fuzzy_match', value: ['x'] },
    };
    const result = validateL2(dsl, fieldDict, opWhitelist);
    expect(result.ok).toBe(false);
  });

  it('rejects non-empty extensions', () => {
    const dsl = {
      ...validDsl,
      root: { node_type: 'predicate', id: 'c1', field: 'content', operator: 'contains_any', value: ['x'], extensions: { custom: true } },
    };
    const result = validateL2(dsl, fieldDict, opWhitelist);
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('UNSUPPORTED_EXTENSIONS');
  });

  it('rejects value_ref', () => {
    const dsl = {
      ...validDsl,
      root: { node_type: 'predicate', id: 'c1', field: 'content', operator: 'contains_any', value: ['x'], value_ref: 'lexicon:core' },
    };
    const result = validateL2(dsl, fieldDict, opWhitelist);
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('UNSUPPORTED_VALUE_REF');
  });

  it('rejects duplicate node ids', () => {
    const dsl = {
      ...validDsl,
      root: {
        node_type: 'or', id: 'c1', children: [
          { node_type: 'predicate', id: 'c1', field: 'content', operator: 'contains_any', value: ['x'] },
          { node_type: 'predicate', id: 'c2', field: 'content', operator: 'contains_any', value: ['y'] },
        ],
      },
    };
    const result = validateL2(dsl, fieldDict, opWhitelist);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.code === 'DUPLICATE_NODE_ID')).toBe(true);
  });

  it('rejects and node with less than 2 children', () => {
    const dsl = {
      ...validDsl,
      root: {
        node_type: 'and', id: 'n1', children: [
          { node_type: 'predicate', id: 'c1', field: 'content', operator: 'contains_any', value: ['x'] },
        ],
      },
    };
    const result = validateL2(dsl, fieldDict, opWhitelist);
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('INSUFFICIENT_CHILDREN');
  });

  it('passes valid AST', () => {
    const result = validateL2(validDsl, fieldDict, opWhitelist);
    expect(result.ok).toBe(true);
  });
});

describe('validateDsl - combined', () => {
  it('accepts string input (L1+L2+L3)', () => {
    const result = validateDsl(JSON.stringify(validDsl), fieldDict, opWhitelist);
    expect(result.ok).toBe(true);
    expect(result.reached_level).toBe('L3');
    expect(result.parsed).toBeDefined();
  });

  it('accepts object input (skips L1)', () => {
    const result = validateDsl(validDsl, fieldDict, opWhitelist);
    expect(result.ok).toBe(true);
    expect(result.reached_level).toBe('L3');
  });

  it('returns L1 for invalid JSON string', () => {
    const result = validateDsl('{broken', fieldDict, opWhitelist);
    expect(result.ok).toBe(false);
    expect(result.reached_level).toBe('L1');
  });

  it('validates complex nested AST', () => {
    const complexDsl: RuleDSL = {
      dsl_version: '1.0',
      rule_id: 'R_002',
      name: 'Complex Rule',
      root: {
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
            child: { node_type: 'predicate', id: 'c3', field: 'author_id', operator: 'in_set', value: ['trusted_1'] },
          },
        ],
      },
      action: { type: 'review', severity: 'medium' },
      semantics: { mode: 'boolean' },
    };
    const result = validateDsl(complexDsl, fieldDict, opWhitelist);
    expect(result.ok).toBe(true);
  });
});

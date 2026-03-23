import type { OperatorSpec, ValidationResult } from '../types.js';

export const notInSetOp: OperatorSpec = {
  name: 'not_in_set',
  supported_field_types: ['string', 'number', 'string[]'],
  complexity_cost: 1,

  validateValue(value: unknown): ValidationResult {
    if (!Array.isArray(value) || value.length === 0) {
      return { ok: false, errors: [{ level: 'L2', path: 'value', message: 'not_in_set requires a non-empty array', code: 'INVALID_VALUE' }] };
    }
    return { ok: true, errors: [] };
  },

  execute(fieldValue: unknown, value: unknown) {
    const set = value as unknown[];
    const hit = !set.includes(fieldValue);
    return {
      hit,
      evidence: hit
        ? { detail: `"${fieldValue}" not in set` }
        : { matched_text: String(fieldValue), detail: `"${fieldValue}" found in set (not_in_set fails)` },
    };
  },

  explain(result) {
    return result.evidence?.detail ?? (result.hit ? '值不在集合中' : '值在集合中');
  },
};

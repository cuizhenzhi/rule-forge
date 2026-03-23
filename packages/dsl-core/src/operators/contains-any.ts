import type { OperatorSpec, ValidationResult } from '../types.js';

export const containsAnyOp: OperatorSpec = {
  name: 'contains_any',
  supported_field_types: ['string'],
  complexity_cost: 1,

  validateValue(value: unknown): ValidationResult {
    if (!Array.isArray(value) || value.length === 0) {
      return { ok: false, errors: [{ level: 'L2', path: 'value', message: 'contains_any requires a non-empty string array', code: 'INVALID_VALUE' }] };
    }
    if (!value.every((v) => typeof v === 'string')) {
      return { ok: false, errors: [{ level: 'L2', path: 'value', message: 'contains_any value must contain only strings', code: 'INVALID_VALUE_TYPE' }] };
    }
    return { ok: true, errors: [] };
  },

  execute(fieldValue: unknown, value: unknown) {
    const text = String(fieldValue);
    const terms = value as string[];
    for (const term of terms) {
      const idx = text.indexOf(term);
      if (idx !== -1) {
        return {
          hit: true,
          evidence: {
            matched_text: term,
            matched_terms: [term],
            span: [idx, idx + term.length] as [number, number],
          },
        };
      }
    }
    return { hit: false, evidence: null };
  },

  explain(result) {
    if (result.hit && result.evidence?.matched_text) {
      return `命中词项: "${result.evidence.matched_text}"`;
    }
    return '未命中任何词项';
  },
};

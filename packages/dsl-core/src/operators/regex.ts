import type { OperatorSpec, ValidationResult } from '../types.js';

export const regexOp: OperatorSpec = {
  name: 'regex',
  supported_field_types: ['string'],
  complexity_cost: 2,

  validateValue(value: unknown): ValidationResult {
    if (typeof value !== 'string') {
      return { ok: false, errors: [{ level: 'L2', path: 'value', message: 'regex requires a string pattern', code: 'INVALID_VALUE' }] };
    }
    try {
      new RegExp(value);
    } catch {
      return { ok: false, errors: [{ level: 'L3', path: 'value', message: `Invalid regex pattern: ${value}`, code: 'INVALID_REGEX' }] };
    }
    return { ok: true, errors: [] };
  },

  execute(fieldValue: unknown, value: unknown) {
    const text = String(fieldValue);
    const pattern = new RegExp(value as string);
    const match = pattern.exec(text);
    if (match) {
      return {
        hit: true,
        evidence: {
          matched_text: match[0],
          span: [match.index, match.index + match[0].length] as [number, number],
        },
      };
    }
    return { hit: false, evidence: null };
  },

  explain(result) {
    if (result.hit && result.evidence?.matched_text) {
      return `正则命中: "${result.evidence.matched_text}"`;
    }
    return '正则未命中';
  },
};

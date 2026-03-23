import type { OperatorSpec, ValidationResult } from '../types.js';

export const lenLtOp: OperatorSpec = {
  name: 'len_lt',
  supported_field_types: ['string'],
  complexity_cost: 1,

  validateValue(value: unknown): ValidationResult {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { ok: false, errors: [{ level: 'L2', path: 'value', message: 'len_lt requires a finite number', code: 'INVALID_VALUE' }] };
    }
    return { ok: true, errors: [] };
  },

  execute(fieldValue: unknown, value: unknown) {
    const len = String(fieldValue).length;
    const threshold = value as number;
    const hit = len < threshold;
    return {
      hit,
      evidence: { detail: `length=${len}, threshold=${threshold}`, count: len },
    };
  },

  explain(result) {
    return result.evidence?.detail ?? (result.hit ? '长度低于阈值' : '长度未低于阈值');
  },
};

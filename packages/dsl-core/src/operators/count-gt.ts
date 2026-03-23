import type { OperatorSpec, ValidationResult } from '../types.js';

type CountGtValue = { target: string; threshold: number };

function isCountGtValue(v: unknown): v is CountGtValue {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  return typeof obj.target === 'string' && typeof obj.threshold === 'number';
}

export const countGtOp: OperatorSpec = {
  name: 'count_gt',
  supported_field_types: ['string'],
  complexity_cost: 2,

  validateValue(value: unknown): ValidationResult {
    if (!isCountGtValue(value)) {
      return {
        ok: false,
        errors: [{
          level: 'L2',
          path: 'value',
          message: 'count_gt requires { target: string, threshold: number }',
          code: 'INVALID_VALUE',
        }],
      };
    }
    if (!Number.isFinite(value.threshold) || value.threshold < 0) {
      return {
        ok: false,
        errors: [{
          level: 'L2',
          path: 'value.threshold',
          message: 'threshold must be a non-negative finite number',
          code: 'INVALID_THRESHOLD',
        }],
      };
    }
    return { ok: true, errors: [] };
  },

  execute(fieldValue: unknown, value: unknown) {
    const text = String(fieldValue);
    const { target, threshold } = value as CountGtValue;
    let count = 0;
    let idx = 0;
    while (true) {
      const found = text.indexOf(target, idx);
      if (found === -1) break;
      count++;
      idx = found + target.length;
    }
    const hit = count > threshold;
    return {
      hit,
      evidence: {
        count,
        detail: `"${target}" appears ${count} time(s), threshold=${threshold}`,
      },
    };
  },

  explain(result) {
    return result.evidence?.detail ?? (result.hit ? '次数超过阈值' : '次数未超过阈值');
  },
};

import { describe, it, expect } from 'vitest';
import { computeMetrics, computeMacroF1, perClassF1OneVsRest } from '../evaluator.js';

describe('computeMetrics', () => {
  it('perfect separation', () => {
    const m = computeMetrics([0, 0, 1, 1], [0, 0, 1, 1]);
    expect(m.accuracy).toBe(1);
    expect(m.precision).toBe(1);
    expect(m.recall).toBe(1);
    expect(m.f1).toBe(1);
    expect(m.confusion).toEqual({ tp: 2, tn: 2, fp: 0, fn: 0 });
  });

  it('all wrong positive', () => {
    const m = computeMetrics([1, 1, 1, 1], [0, 0, 1, 1]);
    expect(m.confusion).toEqual({ tp: 2, fp: 2, tn: 0, fn: 0 });
    expect(m.precision).toBe(0.5);
    expect(m.recall).toBe(1);
  });

  it('throws on length mismatch', () => {
    expect(() => computeMetrics([0], [0, 1])).toThrow(/mismatch/);
  });
});

describe('computeMacroF1', () => {
  it('averages', () => {
    expect(computeMacroF1([0.8, 0.6])).toBe(0.7);
  });
});

describe('perClassF1OneVsRest', () => {
  it('symmetric perfect', () => {
    const [f0, f1] = perClassF1OneVsRest([0, 1], [0, 1]);
    expect(f1).toBe(1);
    expect(f0).toBe(1);
  });
});

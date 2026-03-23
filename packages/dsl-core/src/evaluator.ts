/**
 * Binary classification metrics (positive class = 1 = non_compliant).
 * Single source of truth for rule baseline and BERT test evaluation.
 */

export type BinaryConfusion = {
  tp: number;
  fp: number;
  tn: number;
  fn: number;
};

export type BinaryMetrics = {
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  supportPositive: number;
  supportNegative: number;
  confusion: BinaryConfusion;
};

function safeDiv(a: number, b: number): number {
  return b === 0 ? 0 : a / b;
}

export function computeMetrics(predictions: number[], labels: number[]): BinaryMetrics {
  if (predictions.length !== labels.length) {
    throw new Error(`predictions/labels length mismatch: ${predictions.length} vs ${labels.length}`);
  }
  let tp = 0,
    fp = 0,
    tn = 0,
    fn = 0;
  for (let i = 0; i < labels.length; i++) {
    const y = labels[i];
    const p = predictions[i];
    if (y !== 0 && y !== 1) throw new Error(`Invalid label at ${i}: ${y}`);
    if (p !== 0 && p !== 1) throw new Error(`Invalid prediction at ${i}: ${p}`);
    if (y === 1 && p === 1) tp++;
    else if (y === 0 && p === 1) fp++;
    else if (y === 0 && p === 0) tn++;
    else fn++;
  }
  const supportPositive = tp + fn;
  const supportNegative = tn + fp;
  const precision = safeDiv(tp, tp + fp);
  const recall = safeDiv(tp, tp + fn);
  const f1 = safeDiv(2 * precision * recall, precision + recall);
  const accuracy = safeDiv(tp + tn, tp + tn + fp + fn);
  return {
    accuracy,
    precision,
    recall,
    f1,
    supportPositive,
    supportNegative,
    confusion: { tp, fp, tn, fn },
  };
}

/** Macro-F1 from per-class binary one-vs-rest metrics (e.g. class 0 then class 1). */
export function computeMacroF1(perClassF1: number[]): number {
  if (perClassF1.length === 0) return 0;
  return perClassF1.reduce((a, b) => a + b, 0) / perClassF1.length;
}

/** Per-class F1 for binary (positive=1); returns [f1_class0, f1_class1] one-vs-rest. */
export function perClassF1OneVsRest(predictions: number[], labels: number[]): [number, number] {
  const invPred = predictions.map((p) => (p === 1 ? 0 : 1));
  const invLab = labels.map((y) => (y === 1 ? 0 : 1));
  const mPos = computeMetrics(predictions, labels);
  const mNeg = computeMetrics(invPred, invLab);
  return [mNeg.f1, mPos.f1];
}

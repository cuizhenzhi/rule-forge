import type { OperatorName, OperatorSpec } from '../types.js';
import { containsAnyOp } from './contains-any.js';
import { regexOp } from './regex.js';
import { lenGtOp } from './len-gt.js';
import { lenLtOp } from './len-lt.js';
import { inSetOp } from './in-set.js';
import { notInSetOp } from './not-in-set.js';
import { countGtOp } from './count-gt.js';

const registry = new Map<OperatorName, OperatorSpec>();

export function registerOperator(spec: OperatorSpec): void {
  registry.set(spec.name, spec);
}

export function getOperator(name: OperatorName): OperatorSpec | undefined {
  return registry.get(name);
}

export function hasOperator(name: string): name is OperatorName {
  return registry.has(name as OperatorName);
}

export function getAllOperatorNames(): OperatorName[] {
  return [...registry.keys()];
}

registerOperator(containsAnyOp);
registerOperator(regexOp);
registerOperator(lenGtOp);
registerOperator(lenLtOp);
registerOperator(inSetOp);
registerOperator(notInSetOp);
registerOperator(countGtOp);

export const operatorRegistry = {
  get: getOperator,
  has: hasOperator,
  all: getAllOperatorNames,
  register: registerOperator,
} as const;

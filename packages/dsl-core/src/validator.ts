import type {
  RuleDSL,
  ExprNode,
  PredicateNode,
  FieldDictEntry,
  OperatorName,
  ValidationError,
  ValidationResult,
  FullValidationResult,
  ValidationLevel,
} from './types.js';
import { OPERATOR_NAMES } from './types.js';
import { operatorRegistry } from './operators/registry.js';
import { collectNodeIds } from './ast-utils.js';

// ---- L1: JSON Parseable ----

export function validateL1(input: string): { ok: boolean; errors: ValidationError[]; parsed?: unknown } {
  const errors: ValidationError[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (e) {
    errors.push({ level: 'L1', path: '$', message: `JSON parse error: ${(e as Error).message}`, code: 'JSON_PARSE_ERROR' });
    return { ok: false, errors };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    errors.push({ level: 'L1', path: '$', message: 'Top-level must be a JSON object', code: 'NOT_OBJECT' });
    return { ok: false, errors };
  }

  const obj = parsed as Record<string, unknown>;
  for (const field of ['dsl_version', 'rule_id', 'root', 'action', 'semantics']) {
    if (!(field in obj)) {
      errors.push({ level: 'L1', path: `$.${field}`, message: `Missing required field: ${field}`, code: 'MISSING_FIELD' });
    }
  }

  return { ok: errors.length === 0, errors, parsed: errors.length === 0 ? parsed : undefined };
}

// ---- L2: Schema Valid ----

export function validateL2(
  dsl: Record<string, unknown>,
  fieldDict: FieldDictEntry[],
  opWhitelist: OperatorName[],
): ValidationResult {
  const errors: ValidationError[] = [];
  const fieldMap = new Map(fieldDict.map((f) => [f.field, f]));
  const opSet = new Set(opWhitelist);

  if (dsl.dsl_version !== '1.0') {
    errors.push({ level: 'L2', path: '$.dsl_version', message: `Expected "1.0", got "${dsl.dsl_version}"`, code: 'INVALID_VERSION' });
  }

  if (typeof dsl.rule_id !== 'string' || dsl.rule_id.length === 0) {
    errors.push({ level: 'L2', path: '$.rule_id', message: 'rule_id must be a non-empty string', code: 'INVALID_RULE_ID' });
  }

  if (typeof dsl.name !== 'string') {
    errors.push({ level: 'L2', path: '$.name', message: 'name must be a string', code: 'INVALID_NAME' });
  }

  const action = dsl.action as Record<string, unknown> | undefined;
  if (!action || typeof action !== 'object') {
    errors.push({ level: 'L2', path: '$.action', message: 'action must be an object', code: 'INVALID_ACTION' });
  } else {
    if (!['block', 'review', 'allow'].includes(action.type as string)) {
      errors.push({ level: 'L2', path: '$.action.type', message: 'action.type must be block|review|allow', code: 'INVALID_ACTION_TYPE' });
    }
    if (!['high', 'medium', 'low'].includes(action.severity as string)) {
      errors.push({ level: 'L2', path: '$.action.severity', message: 'action.severity must be high|medium|low', code: 'INVALID_SEVERITY' });
    }
  }

  const semantics = dsl.semantics as Record<string, unknown> | undefined;
  if (!semantics || semantics.mode !== 'boolean') {
    errors.push({ level: 'L2', path: '$.semantics.mode', message: 'semantics.mode must be "boolean" in v1', code: 'INVALID_SEMANTICS' });
  }

  // Validate AST nodes recursively
  const seenIds = new Set<string>();
  if (dsl.root) {
    validateNode(dsl.root as Record<string, unknown>, '$.root', fieldMap, opSet, seenIds, errors);
  } else {
    errors.push({ level: 'L2', path: '$.root', message: 'root node is required', code: 'MISSING_ROOT' });
  }

  return { ok: errors.length === 0, errors };
}

function validateNode(
  node: Record<string, unknown>,
  path: string,
  fieldMap: Map<string, FieldDictEntry>,
  opSet: Set<OperatorName>,
  seenIds: Set<string>,
  errors: ValidationError[],
): void {
  if (typeof node !== 'object' || node === null) {
    errors.push({ level: 'L2', path, message: 'Node must be an object', code: 'INVALID_NODE' });
    return;
  }

  const id = node.id as string;
  if (typeof id !== 'string' || id.length === 0) {
    errors.push({ level: 'L2', path: `${path}.id`, message: 'Node id must be a non-empty string', code: 'INVALID_NODE_ID' });
  } else if (seenIds.has(id)) {
    errors.push({ level: 'L2', path: `${path}.id`, message: `Duplicate node id: "${id}"`, code: 'DUPLICATE_NODE_ID' });
  } else {
    seenIds.add(id);
  }

  // Reject non-empty extensions
  if (node.extensions && typeof node.extensions === 'object' && Object.keys(node.extensions as object).length > 0) {
    errors.push({ level: 'L2', path: `${path}.extensions`, message: 'v1 does not support extensions', code: 'UNSUPPORTED_EXTENSIONS' });
  }

  const nodeType = node.node_type as string;

  switch (nodeType) {
    case 'and':
    case 'or':
      validateGroupNode(node, path, nodeType, fieldMap, opSet, seenIds, errors);
      break;
    case 'not':
      validateNotNode(node, path, fieldMap, opSet, seenIds, errors);
      break;
    case 'predicate':
      validatePredicateNode(node, path, fieldMap, opSet, errors);
      break;
    default:
      errors.push({ level: 'L2', path: `${path}.node_type`, message: `Unknown node_type: "${nodeType}"`, code: 'UNKNOWN_NODE_TYPE' });
  }
}

function validateGroupNode(
  node: Record<string, unknown>,
  path: string,
  nodeType: string,
  fieldMap: Map<string, FieldDictEntry>,
  opSet: Set<OperatorName>,
  seenIds: Set<string>,
  errors: ValidationError[],
): void {
  const children = node.children;
  if (!Array.isArray(children)) {
    errors.push({ level: 'L2', path: `${path}.children`, message: `${nodeType} node requires a children array`, code: 'MISSING_CHILDREN' });
    return;
  }
  if (children.length < 2) {
    errors.push({ level: 'L2', path: `${path}.children`, message: `${nodeType} node requires at least 2 children`, code: 'INSUFFICIENT_CHILDREN' });
  }
  children.forEach((child, i) => {
    validateNode(child as Record<string, unknown>, `${path}.children[${i}]`, fieldMap, opSet, seenIds, errors);
  });
}

function validateNotNode(
  node: Record<string, unknown>,
  path: string,
  fieldMap: Map<string, FieldDictEntry>,
  opSet: Set<OperatorName>,
  seenIds: Set<string>,
  errors: ValidationError[],
): void {
  if (!node.child || typeof node.child !== 'object') {
    errors.push({ level: 'L2', path: `${path}.child`, message: 'not node requires exactly one child', code: 'MISSING_CHILD' });
    return;
  }
  if ('children' in node) {
    errors.push({ level: 'L2', path: `${path}`, message: 'not node must use "child", not "children"', code: 'NOT_USES_CHILDREN' });
  }
  validateNode(node.child as Record<string, unknown>, `${path}.child`, fieldMap, opSet, seenIds, errors);
}

function validatePredicateNode(
  node: Record<string, unknown>,
  path: string,
  fieldMap: Map<string, FieldDictEntry>,
  opSet: Set<OperatorName>,
  errors: ValidationError[],
): void {
  // Reject value_ref
  if (node.value_ref !== undefined) {
    errors.push({ level: 'L2', path: `${path}.value_ref`, message: 'v1 does not support value_ref', code: 'UNSUPPORTED_VALUE_REF' });
  }

  const field = node.field as string;
  if (typeof field !== 'string') {
    errors.push({ level: 'L2', path: `${path}.field`, message: 'predicate field must be a string', code: 'INVALID_FIELD' });
    return;
  }

  const fieldEntry = fieldMap.get(field);
  if (!fieldEntry) {
    errors.push({ level: 'L2', path: `${path}.field`, message: `Unknown field: "${field}"`, code: 'UNKNOWN_FIELD' });
    return;
  }

  const op = node.operator as string;
  if (typeof op !== 'string') {
    errors.push({ level: 'L2', path: `${path}.operator`, message: 'predicate operator must be a string', code: 'INVALID_OPERATOR' });
    return;
  }

  if (!opSet.has(op as OperatorName)) {
    errors.push({ level: 'L2', path: `${path}.operator`, message: `Operator not in whitelist: "${op}"`, code: 'OPERATOR_NOT_WHITELISTED' });
    return;
  }

  if (!(OPERATOR_NAMES as readonly string[]).includes(op)) {
    errors.push({ level: 'L2', path: `${path}.operator`, message: `Unknown operator: "${op}"`, code: 'UNKNOWN_OPERATOR' });
    return;
  }

  const spec = operatorRegistry.get(op as OperatorName);
  if (!spec) {
    errors.push({ level: 'L2', path: `${path}.operator`, message: `No registry entry for operator: "${op}"`, code: 'UNREGISTERED_OPERATOR' });
    return;
  }

  // Check field type compatibility
  if (!spec.supported_field_types.includes(fieldEntry.type)) {
    errors.push({
      level: 'L2',
      path: `${path}`,
      message: `Operator "${op}" does not support field type "${fieldEntry.type}" (field: "${field}")`,
      code: 'FIELD_TYPE_MISMATCH',
    });
  }

  // Validate value using operator spec
  if (node.value === undefined) {
    errors.push({ level: 'L2', path: `${path}.value`, message: 'predicate value is required', code: 'MISSING_VALUE' });
  } else {
    const valResult = spec.validateValue(node.value);
    if (!valResult.ok) {
      errors.push(...valResult.errors.map((e) => ({ ...e, path: `${path}.${e.path}` })));
    }
  }
}

// ---- L3: Executable ----

export function validateL3(dsl: RuleDSL): ValidationResult {
  const errors: ValidationError[] = [];
  validateNodeExecutable(dsl.root, '$.root', errors, 0);
  return { ok: errors.length === 0, errors };
}

function validateNodeExecutable(
  node: ExprNode,
  path: string,
  errors: ValidationError[],
  depth: number,
): void {
  if (depth > 100) {
    errors.push({ level: 'L3', path, message: 'AST depth exceeds 100 — possibly cyclic or too deeply nested', code: 'EXCESSIVE_DEPTH' });
    return;
  }

  switch (node.node_type) {
    case 'and':
    case 'or':
      for (let i = 0; i < node.children.length; i++) {
        validateNodeExecutable(node.children[i], `${path}.children[${i}]`, errors, depth + 1);
      }
      break;
    case 'not':
      validateNodeExecutable(node.child, `${path}.child`, errors, depth + 1);
      break;
    case 'predicate':
      validatePredicateExecutable(node, path, errors);
      break;
  }
}

function validatePredicateExecutable(node: PredicateNode, path: string, errors: ValidationError[]): void {
  const spec = operatorRegistry.get(node.operator);
  if (!spec) {
    errors.push({ level: 'L3', path: `${path}.operator`, message: `No executor for operator: "${node.operator}"`, code: 'NO_EXECUTOR' });
    return;
  }

  // For regex, verify compilation
  if (node.operator === 'regex' && typeof node.value === 'string') {
    try {
      new RegExp(node.value);
    } catch (e) {
      errors.push({ level: 'L3', path: `${path}.value`, message: `Regex not compilable: ${(e as Error).message}`, code: 'REGEX_COMPILE_ERROR' });
    }
  }
}

// ---- Combined Entry Point ----

export function validateDsl(
  input: string | RuleDSL | Record<string, unknown>,
  fieldDict: FieldDictEntry[],
  opWhitelist: OperatorName[],
): FullValidationResult {
  let dslObj: Record<string, unknown>;

  // If string, run L1
  if (typeof input === 'string') {
    const l1 = validateL1(input);
    if (!l1.ok) {
      return { ok: false, errors: l1.errors, reached_level: 'L1' };
    }
    dslObj = l1.parsed as Record<string, unknown>;
  } else {
    dslObj = input as Record<string, unknown>;
  }

  // L2
  const l2 = validateL2(dslObj, fieldDict, opWhitelist);
  if (!l2.ok) {
    return { ok: false, errors: l2.errors, reached_level: 'L2' };
  }

  const typedDsl = dslObj as unknown as RuleDSL;

  // L3
  const l3 = validateL3(typedDsl);
  if (!l3.ok) {
    return { ok: false, errors: l3.errors, reached_level: 'L3', parsed: typedDsl };
  }

  return { ok: true, errors: [], reached_level: 'L3', parsed: typedDsl };
}

// ============================================================
// RuleForge DSL v1 — AST-only Type Definitions
// ============================================================

// --- Top-level DSL Rule ---

export type RuleDSL = {
  dsl_version: '1.0';
  rule_id: string;
  name: string;
  root: ExprNode;
  action: RuleAction;
  semantics: RuleSemantics;
  meta?: Record<string, unknown>;
};

export type RuleAction = {
  type: 'block' | 'review' | 'allow';
  severity: 'high' | 'medium' | 'low';
};

export type RuleSemantics = {
  mode: 'boolean';
};

// --- AST Node Types ---

export type ExprNode = AndNode | OrNode | NotNode | PredicateNode;

export type NodeType = 'and' | 'or' | 'not' | 'predicate';

export type BaseNode = {
  id: string;
  meta?: Record<string, unknown>;
  extensions?: Record<string, unknown>;
};

export type AndNode = BaseNode & {
  node_type: 'and';
  children: ExprNode[];
};

export type OrNode = BaseNode & {
  node_type: 'or';
  children: ExprNode[];
};

export type NotNode = BaseNode & {
  node_type: 'not';
  child: ExprNode;
};

export type PredicateNode = BaseNode & {
  node_type: 'predicate';
  field: string;
  operator: OperatorName;
  value?: unknown;
  value_ref?: string;
};

// --- Operator ---

export const OPERATOR_NAMES = [
  'contains_any',
  'regex',
  'len_gt',
  'len_lt',
  'in_set',
  'not_in_set',
  'count_gt',
] as const;

export type OperatorName = (typeof OPERATOR_NAMES)[number];

export type OperatorExecResult = {
  hit: boolean;
  evidence: OperatorEvidence | null;
};

export type OperatorEvidence = {
  matched_text?: string;
  matched_terms?: string[];
  span?: [number, number];
  count?: number;
  detail?: string;
};

export type OperatorSpec = {
  name: OperatorName;
  supported_field_types: FieldType[];
  validateValue: (value: unknown) => ValidationResult;
  execute: (
    fieldValue: unknown,
    value: unknown,
    sample: Record<string, unknown>,
  ) => OperatorExecResult;
  explain: (result: OperatorExecResult) => string;
  complexity_cost: number;
};

// --- Field Dictionary ---

export type FieldType = 'string' | 'number' | 'string[]';

export type FieldDictEntry = {
  field: string;
  type: FieldType;
  source?: 'raw' | 'preprocessing';
  description?: string;
};

// --- Validation ---

export type ValidationLevel = 'L1' | 'L2' | 'L3';

export type ValidationError = {
  level: ValidationLevel;
  path: string;
  message: string;
  code: string;
};

export type ValidationResult = {
  ok: boolean;
  errors: ValidationError[];
};

export type FullValidationResult = ValidationResult & {
  reached_level: ValidationLevel;
  parsed?: RuleDSL;
};

// --- Execution ---

export type TraceNodeStatus = 'evaluated' | 'skipped';

export type TraceNode = {
  node_id: string;
  node_type: NodeType;
  status: TraceNodeStatus;
  result: boolean | null;
  evidence?: OperatorEvidence | null;
  children?: TraceNode[];
  child?: TraceNode;
};

export type ExecutionResult = {
  rule_id: string;
  sample_id: string;
  final_hit: boolean;
  action: RuleAction;
  trace: TraceNode;
};

// --- Complexity ---

export type AstComplexity = {
  nodeCount: number;
  depth: number;
  predicateCount: number;
};

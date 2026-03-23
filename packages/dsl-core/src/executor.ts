import type {
  RuleDSL,
  ExprNode,
  AndNode,
  OrNode,
  NotNode,
  PredicateNode,
  TraceNode,
  ExecutionResult,
} from './types.js';
import { operatorRegistry } from './operators/registry.js';

export function executeRule(
  dsl: RuleDSL,
  sample: Record<string, unknown>,
  sampleId?: string,
): ExecutionResult {
  const trace = executeNode(dsl.root, sample);
  return {
    rule_id: dsl.rule_id,
    sample_id: sampleId ?? (sample.id as string) ?? 'unknown',
    final_hit: trace.result === true,
    action: dsl.action,
    trace,
  };
}

function executeNode(node: ExprNode, sample: Record<string, unknown>): TraceNode {
  switch (node.node_type) {
    case 'and':
      return executeAnd(node, sample);
    case 'or':
      return executeOr(node, sample);
    case 'not':
      return executeNot(node, sample);
    case 'predicate':
      return executePredicate(node, sample);
  }
}

function executeAnd(node: AndNode, sample: Record<string, unknown>): TraceNode {
  const childTraces: TraceNode[] = [];
  let allTrue = true;
  let shortCircuited = false;

  for (const child of node.children) {
    if (shortCircuited) {
      childTraces.push(makeSkippedTrace(child));
      continue;
    }
    const childTrace = executeNode(child, sample);
    childTraces.push(childTrace);
    if (childTrace.result === false) {
      allTrue = false;
      shortCircuited = true;
    }
  }

  return {
    node_id: node.id,
    node_type: 'and',
    status: 'evaluated',
    result: allTrue,
    children: childTraces,
  };
}

function executeOr(node: OrNode, sample: Record<string, unknown>): TraceNode {
  const childTraces: TraceNode[] = [];
  let anyTrue = false;
  let shortCircuited = false;

  for (const child of node.children) {
    if (shortCircuited) {
      childTraces.push(makeSkippedTrace(child));
      continue;
    }
    const childTrace = executeNode(child, sample);
    childTraces.push(childTrace);
    if (childTrace.result === true) {
      anyTrue = true;
      shortCircuited = true;
    }
  }

  return {
    node_id: node.id,
    node_type: 'or',
    status: 'evaluated',
    result: anyTrue,
    children: childTraces,
  };
}

function executeNot(node: NotNode, sample: Record<string, unknown>): TraceNode {
  const childTrace = executeNode(node.child, sample);
  return {
    node_id: node.id,
    node_type: 'not',
    status: 'evaluated',
    result: !childTrace.result,
    child: childTrace,
  };
}

function executePredicate(node: PredicateNode, sample: Record<string, unknown>): TraceNode {
  const spec = operatorRegistry.get(node.operator);
  if (!spec) {
    return {
      node_id: node.id,
      node_type: 'predicate',
      status: 'evaluated',
      result: false,
      evidence: { detail: `No executor for operator: ${node.operator}` },
    };
  }

  const fieldValue = sample[node.field];
  const execResult = spec.execute(fieldValue, node.value, sample);

  return {
    node_id: node.id,
    node_type: 'predicate',
    status: 'evaluated',
    result: execResult.hit,
    evidence: execResult.evidence,
  };
}

function makeSkippedTrace(node: ExprNode): TraceNode {
  const base: TraceNode = {
    node_id: node.id,
    node_type: node.node_type,
    status: 'skipped',
    result: null,
  };

  if (node.node_type === 'and' || node.node_type === 'or') {
    base.children = node.children.map(makeSkippedTrace);
  } else if (node.node_type === 'not') {
    base.child = makeSkippedTrace(node.child);
  }

  return base;
}

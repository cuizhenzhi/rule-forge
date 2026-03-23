import type { TraceNodeData } from '../lib/api';

export default function TraceViewer({ trace }: { trace: TraceNodeData }) {
  return (
    <div className="font-mono text-xs">
      <TraceNodeView node={trace} depth={0} />
    </div>
  );
}

function TraceNodeView({ node, depth }: { node: TraceNodeData; depth: number }) {
  const indent = depth * 20;
  const statusIcon = node.status === 'skipped' ? '⊘' : node.result ? '●' : '○';
  const statusColor =
    node.status === 'skipped'
      ? 'text-gray-400'
      : node.result
        ? 'text-red-600'
        : 'text-green-600';

  const label = buildLabel(node);

  return (
    <div>
      <div className="flex items-start gap-1.5 py-0.5" style={{ paddingLeft: indent }}>
        <span className={`${statusColor} flex-shrink-0 w-3 text-center`}>{statusIcon}</span>
        <span className={node.status === 'skipped' ? 'text-gray-400 italic' : ''}>
          <span className="font-semibold">{node.node_id}</span>
          <span className="text-muted-foreground ml-1">({node.node_type})</span>
          <span className="ml-1">{label}</span>
        </span>
      </div>
      {node.children?.map((child) => (
        <TraceNodeView key={child.node_id} node={child} depth={depth + 1} />
      ))}
      {node.child && <TraceNodeView node={node.child} depth={depth + 1} />}
    </div>
  );
}

function buildLabel(node: TraceNodeData): string {
  if (node.status === 'skipped') return '— skipped (short-circuit)';
  if (node.node_type === 'and') return node.result ? '= all true' : '= short-circuited false';
  if (node.node_type === 'or') return node.result ? '= short-circuited true' : '= all false';
  if (node.node_type === 'not') return `= negated → ${node.result}`;

  // predicate
  if (!node.evidence) return node.result ? '= hit' : '= miss';
  const ev = node.evidence;
  if (ev.matched_text) return `→ hit: "${ev.matched_text}"`;
  if (ev.detail) return `→ ${ev.detail}`;
  if (ev.count !== undefined) return `→ count=${ev.count}`;
  return node.result ? '= hit' : '= miss';
}

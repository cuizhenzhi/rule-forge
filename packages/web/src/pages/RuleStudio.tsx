import { useEffect, useState } from 'react';
import { api, type RuleRow, type RuleVersionRow, type ValidationResponse, type ExecuteResponse } from '../lib/api';
import TraceViewer from '../components/TraceViewer';

export default function RuleStudio() {
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [versions, setVersions] = useState<RuleVersionRow[]>([]);
  const [activeVersion, setActiveVersion] = useState<RuleVersionRow | null>(null);
  const [validation, setValidation] = useState<ValidationResponse | null>(null);
  const [executeResult, setExecuteResult] = useState<ExecuteResponse | null>(null);
  const [sampleText, setSampleText] = useState('');
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.getRules().then((d) => setRules(d.rules)).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!selected) return;
    setValidation(null);
    setExecuteResult(null);
    api.getRule(selected).then((d) => {
      setVersions(d.versions);
      setActiveVersion(d.versions[0] ?? null);
    }).catch((e) => setError(e.message));
  }, [selected]);

  const dslObj = activeVersion?.dsl_json ? JSON.parse(activeVersion.dsl_json) : null;

  async function handleValidate() {
    if (!dslObj) return;
    setLoading('validate');
    setError('');
    try {
      const res = await api.validateDsl(dslObj);
      setValidation(res);
    } catch (e) { setError((e as Error).message); }
    setLoading('');
  }

  async function handleExecute() {
    if (!dslObj || !sampleText.trim()) return;
    setLoading('execute');
    setError('');
    try {
      const sample = { id: 'test_1', content: sampleText, content_norm: sampleText.toLowerCase(), title: '', author_id: 'anonymous' };
      const res = await api.executeDsl(dslObj, [sample]);
      setExecuteResult(res);
    } catch (e) { setError((e as Error).message); }
    setLoading('');
  }

  return (
    <div className="flex h-[calc(100vh-57px)]">
      {/* Left: Rule List */}
      <aside className="w-64 border-r bg-card overflow-y-auto">
        <div className="p-3 border-b">
          <h2 className="text-sm font-semibold text-muted-foreground">Rules ({rules.length})</h2>
        </div>
        {rules.map((r) => (
          <button
            key={r.id}
            onClick={() => setSelected(r.id)}
            className={`w-full text-left px-3 py-2.5 border-b text-sm transition-colors ${
              selected === r.id ? 'bg-accent' : 'hover:bg-muted/50'
            }`}
          >
            <div className="font-medium truncate">{r.code} {r.name}</div>
            <div className="text-xs text-muted-foreground mt-0.5 flex gap-2">
              <StatusBadge status={r.validation_status} />
              {r.is_published ? <span className="text-green-600">Published</span> : null}
            </div>
          </button>
        ))}
      </aside>

      {/* Center + Right: Detail */}
      <div className="flex-1 overflow-y-auto">
        {!selected ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Select a rule from the list
          </div>
        ) : !activeVersion ? (
          <div className="p-6 text-muted-foreground">Loading...</div>
        ) : (
          <div className="p-6 space-y-6 max-w-5xl">
            {error && (
              <div className="bg-destructive/10 text-destructive px-4 py-2 rounded-md text-sm">{error}</div>
            )}

            {/* Rule Info */}
            <section>
              <h2 className="text-xl font-semibold mb-2">{rules.find(r => r.id === selected)?.name}</h2>
              <div className="bg-muted/50 rounded-lg p-4">
                <label className="text-xs font-medium text-muted-foreground">Natural Language Rule</label>
                <p className="mt-1 text-sm">{activeVersion.nl_text}</p>
              </div>
            </section>

            {/* Version Selector */}
            {versions.length > 1 && (
              <section>
                <label className="text-xs font-medium text-muted-foreground">Version</label>
                <div className="flex gap-2 mt-1">
                  {versions.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => { setActiveVersion(v); setValidation(null); setExecuteResult(null); }}
                      className={`px-3 py-1 rounded text-xs font-medium border ${
                        activeVersion.id === v.id ? 'border-primary bg-primary/10' : 'border-border'
                      }`}
                    >
                      v{v.version_no} ({v.candidate_type})
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* AST Preview */}
            {dslObj && (
              <section>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-muted-foreground">AST JSON (DSL)</label>
                  <div className="flex gap-2">
                    <button
                      onClick={handleValidate}
                      disabled={loading === 'validate'}
                      className="px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                      {loading === 'validate' ? 'Validating...' : 'Validate'}
                    </button>
                  </div>
                </div>
                <pre className="bg-muted rounded-lg p-4 text-xs overflow-x-auto max-h-80 font-mono">
                  {JSON.stringify(dslObj, null, 2)}
                </pre>
              </section>
            )}

            {/* Validation Result */}
            {validation && (
              <section>
                <label className="text-xs font-medium text-muted-foreground">Validation Result</label>
                <div className={`mt-1 rounded-lg p-4 ${validation.ok ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                  <div className="flex items-center gap-3 mb-2">
                    <span className={`text-sm font-semibold ${validation.ok ? 'text-green-700' : 'text-red-700'}`}>
                      {validation.ok ? 'All checks passed' : 'Validation failed'}
                    </span>
                    <span className="text-xs text-muted-foreground">Reached: {validation.reached_level}</span>
                  </div>
                  {validation.pretty_text && (
                    <div className="text-xs text-muted-foreground mb-2">
                      <span className="font-medium">Pretty: </span>{validation.pretty_text}
                    </div>
                  )}
                  {validation.complexity && (
                    <div className="text-xs text-muted-foreground mb-2 flex gap-4">
                      <span>Nodes: {validation.complexity.nodeCount}</span>
                      <span>Depth: {validation.complexity.depth}</span>
                      <span>Predicates: {validation.complexity.predicateCount}</span>
                    </div>
                  )}
                  {validation.errors.length > 0 && (
                    <div className="space-y-1 mt-2">
                      {validation.errors.map((e, i) => (
                        <div key={i} className="text-xs text-red-600">
                          [{e.level}] {e.path}: {e.message} ({e.code})
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Execute / Dry Run */}
            <section>
              <label className="text-xs font-medium text-muted-foreground">Test Execute</label>
              <div className="mt-1 flex gap-2">
                <input
                  type="text"
                  value={sampleText}
                  onChange={(e) => setSampleText(e.target.value)}
                  placeholder="Enter sample text to test against this rule..."
                  className="flex-1 px-3 py-2 rounded-md border border-input bg-background text-sm"
                />
                <button
                  onClick={handleExecute}
                  disabled={loading === 'execute' || !sampleText.trim()}
                  className="px-4 py-2 rounded-md text-sm font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50"
                >
                  {loading === 'execute' ? 'Running...' : 'Execute'}
                </button>
              </div>
            </section>

            {/* Execution Result */}
            {executeResult && executeResult.results.length > 0 && (
              <section>
                <label className="text-xs font-medium text-muted-foreground">Execution Result</label>
                <div className="mt-1 space-y-3">
                  {executeResult.results.map((r, i) => (
                    <div key={i} className={`rounded-lg p-4 border ${r.final_hit ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
                      <div className="flex items-center gap-3 mb-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${r.final_hit ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
                          {r.final_hit ? 'HIT — ' + r.action.type.toUpperCase() : 'MISS — PASS'}
                        </span>
                        <span className="text-xs text-muted-foreground">Severity: {r.action.severity}</span>
                      </div>
                      <TraceViewer trace={r.trace} />
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  const colors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600',
    generated: 'bg-blue-100 text-blue-700',
    validated: 'bg-green-100 text-green-700',
    published: 'bg-green-200 text-green-800',
    archived: 'bg-yellow-100 text-yellow-700',
    repair_failed: 'bg-red-100 text-red-700',
  };
  if (!status) return null;
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs ${colors[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  );
}

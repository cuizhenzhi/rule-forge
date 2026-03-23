import { useEffect, useState } from 'react';
import { api, type ExperimentCompareResponse } from '../lib/api';

function fmt(n: number | undefined): string {
  if (n === undefined || Number.isNaN(n)) return '—';
  return (Math.round(n * 10000) / 10000).toString();
}

export default function MetricsDashboard() {
  const [data, setData] = useState<ExperimentCompareResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .getExperimentCompare()
      .then(setData)
      .catch((e: Error) => setErr(e.message));
  }, []);

  const rule = data?.pure_rule;
  const bert = data?.bert;
  const rm = rule?.test_metrics ?? {};
  const bm = bert?.test_metrics ?? {};

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <h2 className="text-xl font-semibold">Metrics Dashboard</h2>
      {err && <p className="text-sm text-destructive">API: {err} (start server)</p>}
      {data?.disclaimer && <p className="text-xs text-muted-foreground">{data.disclaimer}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border rounded-lg p-6 bg-card">
          <h3 className="text-sm font-medium text-muted-foreground">Pure Rule (test)</h3>
          {rule ? (
            <dl className="mt-4 space-y-1 text-sm">
              <div className="flex justify-between">
                <dt>F1</dt>
                <dd className="font-mono">{fmt(rm.test_f1)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Precision</dt>
                <dd className="font-mono">{fmt(rm.test_precision)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Recall</dt>
                <dd className="font-mono">{fmt(rm.test_recall)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Accuracy</dt>
                <dd className="font-mono">{fmt(rm.test_accuracy)}</dd>
              </div>
              <p className="text-xs text-muted-foreground pt-2">
                mode: {(rule.config?.rule_positive_mode as string) ?? '—'}
              </p>
            </dl>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">Run npm run baseline:rules</p>
          )}
        </div>

        <div className="border rounded-lg p-6 bg-card">
          <h3 className="text-sm font-medium text-muted-foreground">Pure BERT (test)</h3>
          {bert ? (
            <dl className="mt-4 space-y-1 text-sm">
              <div className="flex justify-between">
                <dt>F1</dt>
                <dd className="font-mono">{fmt(bm.test_f1)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Precision</dt>
                <dd className="font-mono">{fmt(bm.test_precision)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Recall</dt>
                <dd className="font-mono">{fmt(bm.test_recall)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Accuracy</dt>
                <dd className="font-mono">{fmt(bm.test_accuracy)}</dd>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <dt>val F1 (dev)</dt>
                <dd className="font-mono">{fmt(bm.val_f1)}</dd>
              </div>
              <p className="text-xs text-muted-foreground pt-2">
                input: {(bert.config?.bert_input_field as string) ?? '—'} · threshold:{' '}
                {String(bert.config?.decision_threshold ?? '—')} (
                {String(bert.config?.threshold_source ?? '—')})
              </p>
            </dl>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">Train BERT + register:bert</p>
          )}
        </div>
      </div>

      <div className="border rounded-lg p-6 bg-card">
        <h3 className="text-sm font-medium text-muted-foreground mb-2">Rule + Model Fusion</h3>
        <p className="text-sm text-muted-foreground">Not implemented (Step 2).</p>
      </div>
    </div>
  );
}

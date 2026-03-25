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
  const fusion = data?.fusion;
  const rm = rule?.test_metrics ?? {};
  const bm = bert?.test_metrics ?? {};
  const fm = fusion?.test_metrics ?? {};

  type CardProps = {
    title: string;
    entry: typeof rule;
    m: Record<string, number>;
    extra?: React.ReactNode;
    placeholder?: string;
  };

  function MetricCard({ title, entry, m, extra, placeholder }: CardProps) {
    return (
      <div className="border rounded-lg p-6 bg-card">
        <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
        {entry ? (
          <dl className="mt-4 space-y-1 text-sm">
            <div className="flex justify-between"><dt>F1</dt><dd className="font-mono">{fmt(m.test_f1)}</dd></div>
            <div className="flex justify-between"><dt>Precision</dt><dd className="font-mono">{fmt(m.test_precision)}</dd></div>
            <div className="flex justify-between"><dt>Recall</dt><dd className="font-mono">{fmt(m.test_recall)}</dd></div>
            <div className="flex justify-between"><dt>Accuracy</dt><dd className="font-mono">{fmt(m.test_accuracy)}</dd></div>
            {extra}
          </dl>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">{placeholder ?? 'No data'}</p>
        )}
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <h2 className="text-xl font-semibold">Metrics Dashboard</h2>
      {err && <p className="text-sm text-destructive">API: {err} (start server)</p>}
      {data?.disclaimer && <p className="text-xs text-muted-foreground">{data.disclaimer}</p>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard
          title="Pure Rule (test)"
          entry={rule}
          m={rm}
          placeholder="Run npm run baseline:rules"
          extra={
            <p className="text-xs text-muted-foreground pt-2">
              mode: {(rule?.config?.rule_positive_mode as string) ?? '—'}
            </p>
          }
        />

        <MetricCard
          title="Pure BERT (test)"
          entry={bert}
          m={bm}
          placeholder="Train BERT + register:bert"
          extra={
            <>
              <div className="flex justify-between text-muted-foreground">
                <dt>val F1 (dev)</dt>
                <dd className="font-mono">{fmt(bm.val_f1)}</dd>
              </div>
              <p className="text-xs text-muted-foreground pt-2">
                input: {(bert?.config?.bert_input_field as string) ?? '—'} · threshold:{' '}
                {String(bert?.config?.decision_threshold ?? '—')} (
                {String(bert?.config?.threshold_source ?? '—')})
              </p>
            </>
          }
        />

        <MetricCard
          title="Rule + BERT Fusion (test)"
          entry={fusion}
          m={fm}
          placeholder="Run npm run fusion:baseline"
          extra={
            fusion?.config ? (
              <p className="text-xs text-muted-foreground pt-2">
                strategy: {String(fusion.config.strategy ?? '—')} ·
                rule decided: {String(fusion.config.rule_decided_count ?? '—')} ·
                BERT fallback: {String(fusion.config.bert_fallback_count ?? '—')}
              </p>
            ) : null
          }
        />
      </div>
    </div>
  );
}

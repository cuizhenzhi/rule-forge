import { Router } from 'express';
import { getDb } from '../db/init.js';

export const experimentsRouter = Router();

function metricsMap(runId: string): Record<string, number> {
  const db = getDb();
  const rows = db
    .prepare('SELECT metric_name, metric_value FROM experiment_metrics WHERE experiment_run_id = ?')
    .all(runId) as { metric_name: string; metric_value: number }[];
  const m: Record<string, number> = {};
  for (const r of rows) m[r.metric_name] = r.metric_value;
  return m;
}

experimentsRouter.get('/compare/summary', (_req, res) => {
  const db = getDb();
  const ruleRun = db
    .prepare(
      `SELECT * FROM experiment_runs WHERE fusion_config_json LIKE '%"route":"pure_rule"%' ORDER BY created_at DESC LIMIT 1`,
    )
    .get() as Record<string, unknown> | undefined;
  const bertRun = db
    .prepare(
      `SELECT * FROM experiment_runs WHERE fusion_config_json LIKE '%"route":"bert"%' ORDER BY created_at DESC LIMIT 1`,
    )
    .get() as Record<string, unknown> | undefined;

  let ruleFusion: Record<string, unknown> | null = null;
  let bertFusion: Record<string, unknown> | null = null;
  try {
    if (ruleRun?.fusion_config_json) ruleFusion = JSON.parse(ruleRun.fusion_config_json as string);
  } catch {
    /* ignore */
  }
  try {
    if (bertRun?.fusion_config_json) bertFusion = JSON.parse(bertRun.fusion_config_json as string);
  } catch {
    /* ignore */
  }

  const fusionRun = db
    .prepare(
      `SELECT * FROM experiment_runs WHERE fusion_config_json LIKE '%"route":"fusion"%' ORDER BY created_at DESC LIMIT 1`,
    )
    .get() as Record<string, unknown> | undefined;

  let fusionConfig: Record<string, unknown> | null = null;
  try {
    if (fusionRun?.fusion_config_json) fusionConfig = JSON.parse(fusionRun.fusion_config_json as string);
  } catch {
    /* ignore */
  }

  res.json({
    disclaimer: 'Primary comparison: test split only. val_f1 on BERT row is dev monitoring.',
    pure_rule: ruleRun
      ? {
          experiment_run_id: ruleRun.id,
          config: ruleFusion,
          test_metrics: ruleRun.id ? metricsMap(ruleRun.id as string) : {},
        }
      : null,
    bert: bertRun
      ? {
          experiment_run_id: bertRun.id,
          config: bertFusion,
          test_metrics: bertRun.id ? metricsMap(bertRun.id as string) : {},
        }
      : null,
    fusion: fusionRun
      ? {
          experiment_run_id: fusionRun.id,
          config: fusionConfig,
          test_metrics: fusionRun.id ? metricsMap(fusionRun.id as string) : {},
        }
      : null,
  });
});

experimentsRouter.get('/', (_req, res) => {
  const db = getDb();
  const runs = db.prepare('SELECT * FROM experiment_runs ORDER BY created_at DESC').all() as Record<string, unknown>[];
  const withMetrics = runs.map((r) => ({
    ...r,
    metrics: metricsMap(r.id as string),
  }));
  res.json({ experiments: withMetrics });
});

experimentsRouter.get('/:id', (req, res) => {
  if (req.params.id === 'compare') {
    res.status(404).json({ error: 'Use /compare/summary' });
    return;
  }
  const db = getDb();
  const run = db.prepare('SELECT * FROM experiment_runs WHERE id = ?').get(req.params.id);
  if (!run) {
    res.status(404).json({ error: 'Experiment not found' });
    return;
  }
  const metrics = db.prepare('SELECT * FROM experiment_metrics WHERE experiment_run_id = ?').all(req.params.id);
  const rules = db
    .prepare('SELECT * FROM experiment_run_rules WHERE experiment_run_id = ? ORDER BY rule_order')
    .all(req.params.id);
  res.json({ experiment: run, metrics, rules });
});

experimentsRouter.post('/run', (_req, res) => {
  res.status(501).json({ error: 'Experiment run not yet implemented' });
});

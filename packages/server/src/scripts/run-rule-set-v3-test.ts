/**
 * Final test evaluation of frozen rule_set_v3. Run ONCE.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { executeRule, computeMetrics, type RuleDSL } from '@ruleforge/dsl-core';
import { getDb } from '../db/init.js';
import { seedDatabase } from '../db/seed.js';
import type { ToxicSample } from './import-toxicn.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

function main(): void {
  const ruleSetPath = join(REPO_ROOT, 'data', 'rule_experiments', 'rule_set_v3.json');
  const ruleSet = JSON.parse(readFileSync(ruleSetPath, 'utf-8')) as {
    version: string; frozen: boolean; rules: RuleDSL[]; total_rule_count: number;
    base_version: string; iteration: string;
  };

  if (!ruleSet.frozen) { console.error('Not frozen.'); process.exit(1); }

  const testSamples = JSON.parse(readFileSync(
    join(REPO_ROOT, 'data', 'datasets', 'toxicn_test.json'), 'utf-8',
  )) as ToxicSample[];

  const preds: number[] = [];
  const labels: number[] = [];
  for (const s of testSamples) {
    const sample = { content: s.content, content_norm: s.content_norm, title: '', author_id: '' };
    let pred = 0;
    for (const dsl of ruleSet.rules) {
      const res = executeRule(dsl, sample, s.sample_id);
      if (res.final_hit && res.action.type === 'block') { pred = 1; break; }
    }
    preds.push(pred);
    labels.push(s.label);
  }

  const metrics = computeMetrics(preds, labels);

  const metricsOut = {
    version: ruleSet.version,
    base_version: ruleSet.base_version,
    iteration: ruleSet.iteration,
    split: 'test',
    rule_count: ruleSet.rules.length,
    rule_positive_mode: 'block_only',
    metrics,
  };
  const outPath = join(REPO_ROOT, 'data', 'rule_experiments', 'rule_set_v3_test_metrics.json');
  writeFileSync(outPath, JSON.stringify(metricsOut, null, 2), 'utf-8');

  const db = getDb();
  seedDatabase(db);
  const splitRow = db.prepare("SELECT id FROM dataset_splits WHERE dataset_id = ? AND split_name = 'test'")
    .get('dataset_toxicn_v1') as { id: string } | undefined;
  if (!splitRow) { console.error('Run import-toxicn first.'); process.exit(1); }

  const runId = uuidv4();
  db.prepare(
    `INSERT INTO experiment_runs (id, dataset_split_id, fusion_config_json, seed, status) VALUES (?, ?, ?, ?, 'success')`,
  ).run(runId, splitRow.id, JSON.stringify({
    route: 'pure_rule', rule_set_version: 'v3', iteration: 'fn_driven',
    rule_positive_mode: 'block_only', rule_count: ruleSet.rules.length, split: 'test',
  }), 42);

  const insM = db.prepare(
    `INSERT INTO experiment_metrics (id, experiment_run_id, metric_scope, metric_name, metric_value, extra_json) VALUES (?, ?, 'rule_set', ?, ?, ?)`,
  );
  const mid = () => uuidv4();
  insM.run(mid(), runId, 'test_accuracy', metrics.accuracy, null);
  insM.run(mid(), runId, 'test_precision', metrics.precision, null);
  insM.run(mid(), runId, 'test_recall', metrics.recall, null);
  insM.run(mid(), runId, 'test_f1', metrics.f1, null);
  insM.run(mid(), runId, 'test_support_positive', metrics.supportPositive,
    JSON.stringify({ confusion: metrics.confusion }));

  console.log(JSON.stringify({ experiment_run_id: runId, ...metricsOut }, null, 2));
}

main();

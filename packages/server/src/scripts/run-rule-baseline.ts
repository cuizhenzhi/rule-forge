/**
 * Pure-rule baseline on held-out test only. block_only default.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { executeRule, computeMetrics, type RuleDSL } from '@ruleforge/dsl-core';
import { getDb } from '../db/init.js';
import { seedDatabase } from '../db/seed.js';
import type { ToxicSample } from './import-toxicn.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

type RulePositiveMode = 'block_only' | 'block_or_review';

function predictFromRules(
  rules: RuleDSL[],
  sample: Record<string, unknown>,
  sampleId: string,
  mode: RulePositiveMode,
): 0 | 1 {
  for (const dsl of rules) {
    const res = executeRule(dsl, sample, sampleId);
    if (!res.final_hit) continue;
    if (mode === 'block_only') {
      if (res.action.type === 'block') return 1;
    } else if (res.action.type === 'block' || res.action.type === 'review') {
      return 1;
    }
  }
  return 0;
}

function main(): void {
  const mode = (process.env.RULE_POSITIVE_MODE as RulePositiveMode) || 'block_only';
  const testPath = join(REPO_ROOT, 'data', 'datasets', 'toxicn_test.json');
  const samples = JSON.parse(readFileSync(testPath, 'utf-8')) as ToxicSample[];

  const db = getDb();
  seedDatabase(db);
  const rows = db
    .prepare(
      `SELECT dsl_json FROM rule_versions WHERE is_published = 1 AND dsl_json IS NOT NULL`,
    )
    .all() as { dsl_json: string }[];

  if (rows.length === 0) {
    console.error('No published rules with DSL found.');
    process.exit(1);
  }

  const rules = rows.map((r) => JSON.parse(r.dsl_json) as RuleDSL);
  const predictions: number[] = [];
  const labels: number[] = [];

  for (const s of samples) {
    const sample = {
      content: s.content,
      content_norm: s.content_norm,
      title: '',
      author_id: '',
    };
    predictions.push(predictFromRules(rules, sample, s.sample_id));
    labels.push(s.label);
  }

  const metrics = computeMetrics(predictions, labels);
  const splitRow = db
    .prepare(`SELECT id FROM dataset_splits WHERE dataset_id = ? AND split_name = 'test'`)
    .get('dataset_toxicn_v1') as { id: string } | undefined;
  if (!splitRow) {
    console.error('Run import-toxicn first.');
    process.exit(1);
  }

  const runId = uuidv4();
  db.prepare(
    `INSERT INTO experiment_runs (id, dataset_split_id, fusion_config_json, seed, status)
     VALUES (?, ?, ?, ?, 'success')`,
  ).run(
    runId,
    splitRow.id,
    JSON.stringify({
      route: 'pure_rule',
      rule_positive_mode: mode,
      rule_count: rules.length,
      split: 'test',
    }),
    42,
  );

  const insM = db.prepare(
    `INSERT INTO experiment_metrics (id, experiment_run_id, metric_scope, metric_name, metric_value, extra_json)
     VALUES (?, ?, 'rule_set', ?, ?, ?)`,
  );
  const mid = () => uuidv4();
  insM.run(mid(), runId, 'test_accuracy', metrics.accuracy, null);
  insM.run(mid(), runId, 'test_precision', metrics.precision, null);
  insM.run(mid(), runId, 'test_recall', metrics.recall, null);
  insM.run(mid(), runId, 'test_f1', metrics.f1, null);
  insM.run(
    mid(),
    runId,
    'test_support_positive',
    metrics.supportPositive,
    JSON.stringify({ confusion: metrics.confusion }),
  );

  console.log(JSON.stringify({ experiment_run_id: runId, mode, metrics }, null, 2));
}

main();

/**
 * Minimal rule-first fusion baseline on test.
 *
 * Two-stage logic per sample:
 *   1. If any rule in rule_set_v2 fires with action.type === 'block' → predicted 1
 *   2. Else fall back to BERT's predicted_label from predictions_test.json
 *
 * Output:
 *   - data/rule_experiments/predictions_fusion_test.json
 *   - experiment_runs + experiment_metrics in DB
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
  const ruleSetPath = join(REPO_ROOT, 'data', 'rule_experiments', 'rule_set_v2.json');
  const bertPredPath = join(REPO_ROOT, 'data', 'models', 'bert_base_zh_v1', 'predictions_test.json');
  const testPath = join(REPO_ROOT, 'data', 'datasets', 'toxicn_test.json');

  const ruleSet = JSON.parse(readFileSync(ruleSetPath, 'utf-8')) as { rules: RuleDSL[]; frozen: boolean };
  if (!ruleSet.frozen) {
    console.error('rule_set_v2 is not frozen.');
    process.exit(1);
  }

  const bertPred = JSON.parse(readFileSync(bertPredPath, 'utf-8')) as {
    decision_threshold: number;
    threshold_source: string;
    bert_input_field: string;
    predictions: Array<{ sample_id: string; predicted_label: number; gold_label: number; prob_non_compliant: number }>;
  };

  const testSamples = JSON.parse(readFileSync(testPath, 'utf-8')) as ToxicSample[];

  // Index BERT predictions by sample_id
  const bertMap = new Map<string, number>();
  for (const p of bertPred.predictions) {
    bertMap.set(p.sample_id, p.predicted_label);
  }

  const rules = ruleSet.rules;
  const predictions: number[] = [];
  const labels: number[] = [];
  let ruleDecided = 0;
  let bertFallback = 0;

  const perSample: Array<{
    sample_id: string;
    source: 'rule' | 'bert';
    predicted_label: number;
    gold_label: number;
  }> = [];

  for (const s of testSamples) {
    const sample = { content: s.content, content_norm: s.content_norm, title: '', author_id: '' };
    let ruleBlocked = false;

    for (const dsl of rules) {
      const res = executeRule(dsl, sample, s.sample_id);
      if (res.final_hit && res.action.type === 'block') {
        ruleBlocked = true;
        break;
      }
    }

    let pred: number;
    let source: 'rule' | 'bert';

    if (ruleBlocked) {
      pred = 1;
      source = 'rule';
      ruleDecided++;
    } else {
      pred = bertMap.get(s.sample_id) ?? 0;
      source = 'bert';
      bertFallback++;
    }

    predictions.push(pred);
    labels.push(s.label);
    perSample.push({ sample_id: s.sample_id, source, predicted_label: pred, gold_label: s.label });
  }

  const metrics = computeMetrics(predictions, labels);

  // Write predictions file
  const fusionOut = {
    split: 'test',
    fusion_strategy: 'rule_first_bert_fallback',
    rule_set_version: 'v2',
    bert_model: 'bert_base_zh_v1',
    bert_threshold: bertPred.decision_threshold,
    rule_decided_count: ruleDecided,
    bert_fallback_count: bertFallback,
    total: testSamples.length,
    predictions: perSample,
  };
  const fusionPath = join(REPO_ROOT, 'data', 'rule_experiments', 'predictions_fusion_test.json');
  writeFileSync(fusionPath, JSON.stringify(fusionOut, null, 2), 'utf-8');

  // Register in DB
  const db = getDb();
  seedDatabase(db);

  const splitRow = db
    .prepare("SELECT id FROM dataset_splits WHERE dataset_id = ? AND split_name = 'test'")
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
      route: 'fusion',
      strategy: 'rule_first_bert_fallback',
      rule_set_version: 'v2',
      bert_model: 'bert_base_zh_v1',
      bert_threshold: bertPred.decision_threshold,
      split: 'test',
      rule_decided_count: ruleDecided,
      bert_fallback_count: bertFallback,
    }),
    42,
  );

  const insM = db.prepare(
    `INSERT INTO experiment_metrics (id, experiment_run_id, metric_scope, metric_name, metric_value, extra_json)
     VALUES (?, ?, 'fusion', ?, ?, ?)`,
  );
  const mid = () => uuidv4();
  insM.run(mid(), runId, 'test_accuracy', metrics.accuracy, null);
  insM.run(mid(), runId, 'test_precision', metrics.precision, null);
  insM.run(mid(), runId, 'test_recall', metrics.recall, null);
  insM.run(mid(), runId, 'test_f1', metrics.f1, null);
  insM.run(
    mid(), runId, 'test_support_positive', metrics.supportPositive,
    JSON.stringify({ confusion: metrics.confusion }),
  );

  console.log(JSON.stringify({
    experiment_run_id: runId,
    strategy: 'rule_first_bert_fallback',
    rule_decided: ruleDecided,
    bert_fallback: bertFallback,
    total: testSamples.length,
    metrics,
  }, null, 2));
}

main();

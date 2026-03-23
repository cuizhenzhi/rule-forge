/**
 * Register BERT model + store test metrics (same evaluator as rule baseline).
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { computeMetrics } from '@ruleforge/dsl-core';
import { getDb } from '../db/init.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

function main(): void {
  const modelDir = process.env.BERT_MODEL_DIR ?? join(REPO_ROOT, 'data', 'models', 'bert_base_zh_v1');
  const predPath = join(modelDir, 'predictions_test.json');
  const trainCfgPath = join(modelDir, 'train_config.json');
  const metricsValPath = join(modelDir, 'metrics_val.json');

  const pred = JSON.parse(readFileSync(predPath, 'utf-8')) as {
    predictions: { sample_id: string; predicted_label: number; gold_label: number; prob_non_compliant: number }[];
    decision_threshold: number;
    threshold_source: string;
    bert_input_field: string;
  };
  const trainCfg = JSON.parse(readFileSync(trainCfgPath, 'utf-8')) as Record<string, unknown>;
  let metricsVal: Record<string, unknown> = {};
  try {
    metricsVal = JSON.parse(readFileSync(metricsValPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    /* optional */
  }

  const predictions = pred.predictions.map((p) => p.predicted_label);
  const labels = pred.predictions.map((p) => p.gold_label);
  const testMetrics = computeMetrics(predictions, labels);

  const db = getDb();
  const datasetId = 'dataset_toxicn_v1';
  const modelId = uuidv4();
  db.prepare(
    `INSERT INTO model_versions (id, dataset_id, name, framework, artifact_path, metrics_json, data_hash, seed, train_config_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    modelId,
    datasetId,
    'bert-base-chinese toxicn v1',
    'huggingface',
    modelDir,
    JSON.stringify({ val: metricsVal, test: testMetrics, threshold: pred.decision_threshold }),
    null,
    Number(trainCfg.seed) || 42,
    JSON.stringify({
      ...trainCfg,
      decision_threshold: pred.decision_threshold,
      threshold_source: pred.threshold_source,
      bert_input_field: pred.bert_input_field,
    }),
  );

  const splitRow = db
    .prepare(`SELECT id FROM dataset_splits WHERE dataset_id = ? AND split_name = 'test'`)
    .get(datasetId) as { id: string } | undefined;
  if (!splitRow) {
    console.error('Run import-toxicn first.');
    process.exit(1);
  }

  const runId = uuidv4();
  db.prepare(
    `INSERT INTO experiment_runs (id, dataset_split_id, model_version_id, fusion_config_json, seed, status)
     VALUES (?, ?, ?, ?, ?, 'success')`,
  ).run(
    runId,
    splitRow.id,
    modelId,
    JSON.stringify({
      route: 'bert',
      split_evaluated: 'test',
      bert_input_field: pred.bert_input_field,
      decision_threshold: pred.decision_threshold,
      threshold_source: pred.threshold_source,
    }),
    Number(trainCfg.seed) || 42,
  );

  const insM = db.prepare(
    `INSERT INTO experiment_metrics (id, experiment_run_id, metric_scope, metric_name, metric_value, extra_json)
     VALUES (?, ?, 'model', ?, ?, ?)`,
  );
  const mid = () => uuidv4();
  insM.run(mid(), runId, 'test_accuracy', testMetrics.accuracy, null);
  insM.run(mid(), runId, 'test_precision', testMetrics.precision, null);
  insM.run(mid(), runId, 'test_recall', testMetrics.recall, null);
  insM.run(mid(), runId, 'test_f1', testMetrics.f1, null);
  insM.run(
    mid(),
    runId,
    'val_f1',
    Number(metricsVal.f1 ?? 0),
    JSON.stringify({ note: 'dev split only; not primary benchmark' }),
  );

  console.log(JSON.stringify({ model_version_id: modelId, experiment_run_id: runId, testMetrics }, null, 2));
}

main();

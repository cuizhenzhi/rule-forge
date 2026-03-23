/**
 * Evaluate each validated candidate rule on train+val (never test).
 * Output: data/rule_experiments/candidate_metrics.json
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  executeRule,
  computeMetrics,
  astComplexity,
  type RuleDSL,
  type BinaryMetrics,
  type AstComplexity,
} from '@ruleforge/dsl-core';
import type { ToxicSample } from './import-toxicn.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

type CandidateRecord = {
  task_id: string;
  candidate_type: string;
  rule_id: string;
  dsl: RuleDSL;
  [key: string]: unknown;
};

type CandidateMetric = {
  rule_id: string;
  task_id: string;
  candidate_type: string;
  split: string;
  hit_count: number;
  total: number;
  metrics: BinaryMetrics;
  complexity: AstComplexity;
};

function evalRule(
  dsl: RuleDSL,
  samples: ToxicSample[],
  mode: 'block_only' | 'block_or_review',
): { predictions: number[]; labels: number[]; hitCount: number } {
  const predictions: number[] = [];
  const labels: number[] = [];
  let hitCount = 0;
  for (const s of samples) {
    const sample = { content: s.content, content_norm: s.content_norm, title: '', author_id: '' };
    const res = executeRule(dsl, sample, s.sample_id);
    let pred = 0;
    if (res.final_hit) {
      hitCount++;
      if (mode === 'block_only') {
        pred = res.action.type === 'block' ? 1 : 0;
      } else {
        pred = res.action.type === 'block' || res.action.type === 'review' ? 1 : 0;
      }
    }
    predictions.push(pred);
    labels.push(s.label);
  }
  return { predictions, labels, hitCount };
}

function main(): void {
  const validPath = join(REPO_ROOT, 'data', 'rule_experiments', 'validated_candidates.json');
  const candidates = JSON.parse(readFileSync(validPath, 'utf-8')) as CandidateRecord[];

  const trainSamples = JSON.parse(
    readFileSync(join(REPO_ROOT, 'data', 'datasets', 'toxicn_train.json'), 'utf-8'),
  ) as ToxicSample[];
  const valSamples = JSON.parse(
    readFileSync(join(REPO_ROOT, 'data', 'datasets', 'toxicn_val.json'), 'utf-8'),
  ) as ToxicSample[];
  const trainVal = [...trainSamples, ...valSamples];

  console.log(`Evaluating ${candidates.length} candidates on train+val (${trainVal.length} samples)...`);

  const results: CandidateMetric[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (!c.dsl) continue;
    const dsl = c.dsl;

    const comp = astComplexity(dsl.root);

    // Evaluate on train+val combined
    const { predictions, labels, hitCount } = evalRule(dsl, trainVal, 'block_only');
    const metrics = computeMetrics(predictions, labels);

    // Also evaluate on val only for selection step
    const valResult = evalRule(dsl, valSamples, 'block_only');
    const valMetrics = computeMetrics(valResult.predictions, valResult.labels);

    results.push({
      rule_id: c.rule_id,
      task_id: c.task_id,
      candidate_type: c.candidate_type,
      split: 'train_val',
      hit_count: hitCount,
      total: trainVal.length,
      metrics,
      complexity: comp,
    });
    results.push({
      rule_id: c.rule_id,
      task_id: c.task_id,
      candidate_type: c.candidate_type,
      split: 'val',
      hit_count: valResult.hitCount,
      total: valSamples.length,
      metrics: valMetrics,
      complexity: comp,
    });

    console.log(
      `  [${i + 1}/${candidates.length}] ${c.rule_id}: ` +
      `hits=${hitCount} P=${metrics.precision.toFixed(3)} R=${metrics.recall.toFixed(3)} F1=${metrics.f1.toFixed(3)} ` +
      `(val F1=${valMetrics.f1.toFixed(3)})`
    );
  }

  const outPath = join(REPO_ROOT, 'data', 'rule_experiments', 'candidate_metrics.json');
  writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`\nSaved ${results.length} metric records to ${outPath}`);
}

main();

/**
 * Greedy selection: start from 6 seed rules, add candidates one-by-one
 * if they improve val F1. Output frozen rule_set_v2.json.
 * NEVER touches test.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { executeRule, computeMetrics, type RuleDSL, type BinaryMetrics } from '@ruleforge/dsl-core';
import { getDb } from '../db/init.js';
import { seedDatabase } from '../db/seed.js';
import type { ToxicSample } from './import-toxicn.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

type CandidateRecord = { rule_id: string; dsl: RuleDSL; [k: string]: unknown };
type SelectionStep = {
  step: number;
  added_rule_id: string | null;
  rule_count: number;
  val_f1: number;
  val_precision: number;
  val_recall: number;
  delta_f1: number;
};

function predictRuleSet(
  rules: RuleDSL[],
  samples: ToxicSample[],
): { predictions: number[]; labels: number[] } {
  const predictions: number[] = [];
  const labels: number[] = [];
  for (const s of samples) {
    const sample = { content: s.content, content_norm: s.content_norm, title: '', author_id: '' };
    let pred = 0;
    for (const dsl of rules) {
      const res = executeRule(dsl, sample, s.sample_id);
      if (res.final_hit && res.action.type === 'block') {
        pred = 1;
        break;
      }
    }
    predictions.push(pred);
    labels.push(s.label);
  }
  return { predictions, labels };
}

function main(): void {
  const db = getDb();
  seedDatabase(db);

  // Load seed rules from DB
  const seedRows = db
    .prepare('SELECT dsl_json FROM rule_versions WHERE is_published = 1 AND dsl_json IS NOT NULL')
    .all() as { dsl_json: string }[];
  const seedRules = seedRows.map((r) => JSON.parse(r.dsl_json) as RuleDSL);

  // Load validated candidates
  const valCandPath = join(REPO_ROOT, 'data', 'rule_experiments', 'validated_candidates.json');
  const candidates = JSON.parse(readFileSync(valCandPath, 'utf-8')) as CandidateRecord[];
  const candidateDsls = candidates.filter((c) => c.dsl).map((c) => ({ ruleId: c.rule_id, dsl: c.dsl }));

  // Load candidate metrics for pre-filtering (val split)
  const metricsPath = join(REPO_ROOT, 'data', 'rule_experiments', 'candidate_metrics.json');
  const allMetrics = JSON.parse(readFileSync(metricsPath, 'utf-8')) as Array<{
    rule_id: string; split: string; hit_count: number; metrics: BinaryMetrics;
  }>;
  const valMetricsMap = new Map<string, { f1: number; hitCount: number }>();
  for (const m of allMetrics) {
    if (m.split === 'val') valMetricsMap.set(m.rule_id, { f1: m.metrics.f1, hitCount: m.hit_count });
  }

  // Pre-filter: only consider candidates with val hits > 0 and f1 > 0
  const eligible = candidateDsls.filter((c) => {
    const m = valMetricsMap.get(c.ruleId);
    return m && m.hitCount > 0 && m.f1 > 0;
  });
  // Sort by standalone val f1 descending
  eligible.sort((a, b) => {
    const fa = valMetricsMap.get(a.ruleId)?.f1 ?? 0;
    const fb = valMetricsMap.get(b.ruleId)?.f1 ?? 0;
    return fb - fa;
  });

  // Load val samples
  const valSamples = JSON.parse(
    readFileSync(join(REPO_ROOT, 'data', 'datasets', 'toxicn_val.json'), 'utf-8'),
  ) as ToxicSample[];

  // Baseline
  let currentRules = [...seedRules];
  let { predictions, labels } = predictRuleSet(currentRules, valSamples);
  let currentMetrics = computeMetrics(predictions, labels);

  const steps: SelectionStep[] = [{
    step: 0,
    added_rule_id: null,
    rule_count: currentRules.length,
    val_f1: currentMetrics.f1,
    val_precision: currentMetrics.precision,
    val_recall: currentMetrics.recall,
    delta_f1: 0,
  }];

  console.log(`Baseline (${seedRules.length} seed rules): val F1=${currentMetrics.f1.toFixed(4)}`);
  console.log(`Eligible candidates: ${eligible.length} / ${candidateDsls.length}`);

  const selectedIds = new Set<string>();
  const seedRuleIds = new Set(seedRules.map((r) => r.rule_id));

  for (const cand of eligible) {
    if (seedRuleIds.has(cand.ruleId) || selectedIds.has(cand.ruleId)) continue;

    const trial = [...currentRules, cand.dsl];
    const { predictions: tp, labels: tl } = predictRuleSet(trial, valSamples);
    const trialMetrics = computeMetrics(tp, tl);
    const delta = trialMetrics.f1 - currentMetrics.f1;

    if (delta > 0.001) {
      currentRules.push(cand.dsl);
      currentMetrics = trialMetrics;
      selectedIds.add(cand.ruleId);

      steps.push({
        step: steps.length,
        added_rule_id: cand.ruleId,
        rule_count: currentRules.length,
        val_f1: trialMetrics.f1,
        val_precision: trialMetrics.precision,
        val_recall: trialMetrics.recall,
        delta_f1: delta,
      });

      console.log(
        `  +${cand.ruleId}: val F1=${trialMetrics.f1.toFixed(4)} (delta=${delta.toFixed(4)})`,
      );
    }
  }

  const ruleSetV2 = {
    version: 'v2',
    frozen: true,
    seed_rule_count: seedRules.length,
    added_rule_count: currentRules.length - seedRules.length,
    total_rule_count: currentRules.length,
    selection_steps: steps,
    rules: currentRules,
  };

  const outPath = join(REPO_ROOT, 'data', 'rule_experiments', 'rule_set_v2.json');
  writeFileSync(outPath, JSON.stringify(ruleSetV2, null, 2), 'utf-8');

  // Print summary table
  console.log('\n=== Selection Summary ===');
  console.log('Step | Added Rule         | Rules | Val F1   | Delta F1');
  console.log('-----+--------------------+-------+----------+---------');
  for (const s of steps) {
    const rid = s.added_rule_id ?? '(baseline)';
    console.log(
      `  ${String(s.step).padStart(2)} | ${rid.padEnd(18)} | ${String(s.rule_count).padStart(5)} | ${s.val_f1.toFixed(4).padStart(8)} | ${(s.delta_f1 >= 0 ? '+' : '') + s.delta_f1.toFixed(4)}`,
    );
  }

  console.log(`\nFrozen rule_set_v2: ${currentRules.length} rules`);
  console.log(`Saved: ${outPath}`);
}

main();

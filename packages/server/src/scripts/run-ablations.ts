/**
 * Three ablation studies for the thesis:
 *   A. repair vs no-repair
 *   B. candidate_type breakdown (strict / loose / synonyms)
 *   C. block_only vs block_or_review
 *
 * All results written to data/rule_experiments/ablations/
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { executeRule, computeMetrics, type RuleDSL, type BinaryMetrics } from '@ruleforge/dsl-core';
import type { ToxicSample } from './import-toxicn.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const ABL_DIR = join(REPO_ROOT, 'data', 'rule_experiments', 'ablations');

type GenCandidate = {
  task_id: string;
  candidate_type: string;
  rule_id: string;
  dsl: RuleDSL | null;
  validation: {
    ok: boolean;
    reached_level: string;
    repaired: boolean;
    errors: unknown[];
  };
};

type CandMetric = {
  rule_id: string;
  task_id: string;
  candidate_type: string;
  split: string;
  hit_count: number;
  metrics: BinaryMetrics;
};

function loadJson<T>(rel: string): T {
  return JSON.parse(readFileSync(join(REPO_ROOT, rel), 'utf-8')) as T;
}

function evalRuleSet(
  rules: RuleDSL[],
  samples: ToxicSample[],
  mode: 'block_only' | 'block_or_review',
): BinaryMetrics {
  const predictions: number[] = [];
  const labels: number[] = [];
  for (const s of samples) {
    const sample = { content: s.content, content_norm: s.content_norm, title: '', author_id: '' };
    let pred = 0;
    for (const dsl of rules) {
      const res = executeRule(dsl, sample, s.sample_id);
      if (!res.final_hit) continue;
      if (mode === 'block_only' && res.action.type === 'block') { pred = 1; break; }
      if (mode === 'block_or_review' && (res.action.type === 'block' || res.action.type === 'review')) { pred = 1; break; }
    }
    predictions.push(pred);
    labels.push(s.label);
  }
  return computeMetrics(predictions, labels);
}

// ========== A. Repair ablation ==========
function ablationRepair(allCandidates: GenCandidate[]): void {
  const total = allCandidates.length;
  let passWithoutRepair = 0;
  let passWithRepair = 0;

  const byLevel: Record<string, { withRepair: number; withoutRepair: number }> = {
    L1: { withRepair: 0, withoutRepair: 0 },
    L2: { withRepair: 0, withoutRepair: 0 },
    L3: { withRepair: 0, withoutRepair: 0 },
    none: { withRepair: 0, withoutRepair: 0 },
  };

  for (const c of allCandidates) {
    const v = c.validation;
    if (v.ok && !v.repaired) {
      passWithoutRepair++;
      passWithRepair++;
    } else if (v.ok && v.repaired) {
      passWithRepair++;
    }

    if (v.ok) {
      byLevel['L3'].withRepair++;
      if (!v.repaired) byLevel['L3'].withoutRepair++;
    } else {
      const lev = v.reached_level || 'none';
      if (byLevel[lev]) {
        byLevel[lev].withRepair++;
        byLevel[lev].withoutRepair++;
      }
    }
  }

  const repairedCount = allCandidates.filter((c) => c.validation.repaired).length;
  const repairSuccessCount = allCandidates.filter((c) => c.validation.ok && c.validation.repaired).length;

  const result = {
    ablation: 'repair_vs_no_repair',
    total_candidates: total,
    pass_without_repair: passWithoutRepair,
    pass_with_repair: passWithRepair,
    repair_attempted: repairedCount + allCandidates.filter(c => !c.validation.ok && c.validation.reached_level !== 'none').length - repairSuccessCount,
    repair_succeeded: repairSuccessCount,
    pass_rate_without_repair: +(passWithoutRepair / total).toFixed(4),
    pass_rate_with_repair: +(passWithRepair / total).toFixed(4),
    lift: +(passWithRepair - passWithoutRepair),
  };

  writeFileSync(join(ABL_DIR, 'ablation_repair.json'), JSON.stringify(result, null, 2), 'utf-8');
  console.log('\n=== A. Repair Ablation ===');
  console.log(`  Without repair: ${passWithoutRepair}/${total} passed (${(passWithoutRepair/total*100).toFixed(1)}%)`);
  console.log(`  With repair:    ${passWithRepair}/${total} passed (${(passWithRepair/total*100).toFixed(1)}%)`);
  console.log(`  Repair lifted:  +${passWithRepair - passWithoutRepair} candidates`);
}

// ========== B. Candidate type ablation ==========
function ablationCandidateType(
  allCandidates: GenCandidate[],
  candidateMetrics: CandMetric[],
  selectedRuleIds: Set<string>,
): void {
  const types = ['strict', 'loose', 'synonyms'] as const;

  const result: Record<string, {
    generated: number;
    passed: number;
    pass_rate: number;
    selected: number;
    avg_precision: number;
    avg_recall: number;
    avg_f1: number;
  }> = {};

  for (const t of types) {
    const gen = allCandidates.filter((c) => c.candidate_type === t);
    const passed = gen.filter((c) => c.validation.ok);
    const selected = passed.filter((c) => selectedRuleIds.has(c.rule_id));

    const valMetrics = candidateMetrics.filter(
      (m) => m.candidate_type === t && m.split === 'val' && m.hit_count > 0,
    );

    const avgP = valMetrics.length > 0 ? valMetrics.reduce((s, m) => s + m.metrics.precision, 0) / valMetrics.length : 0;
    const avgR = valMetrics.length > 0 ? valMetrics.reduce((s, m) => s + m.metrics.recall, 0) / valMetrics.length : 0;
    const avgF1 = valMetrics.length > 0 ? valMetrics.reduce((s, m) => s + m.metrics.f1, 0) / valMetrics.length : 0;

    result[t] = {
      generated: gen.length,
      passed: passed.length,
      pass_rate: +(passed.length / Math.max(gen.length, 1)).toFixed(4),
      selected: selected.length,
      avg_precision: +avgP.toFixed(4),
      avg_recall: +avgR.toFixed(4),
      avg_f1: +avgF1.toFixed(4),
    };
  }

  writeFileSync(join(ABL_DIR, 'ablation_candidate_type.json'), JSON.stringify({ ablation: 'candidate_type_breakdown', types: result }, null, 2), 'utf-8');
  console.log('\n=== B. Candidate Type Ablation ===');
  console.log('Type      | Gen | Pass | Rate   | Selected | Avg P   | Avg R   | Avg F1');
  console.log('----------+-----+------+--------+----------+---------+---------+-------');
  for (const t of types) {
    const r = result[t];
    console.log(
      `${t.padEnd(9)} | ${String(r.generated).padStart(3)} | ${String(r.passed).padStart(4)} | ${(r.pass_rate * 100).toFixed(1).padStart(5)}% | ${String(r.selected).padStart(8)} | ${r.avg_precision.toFixed(3).padStart(7)} | ${r.avg_recall.toFixed(3).padStart(7)} | ${r.avg_f1.toFixed(3).padStart(6)}`,
    );
  }
}

// ========== C. Rule positive mode ablation ==========
function ablationPositiveMode(testSamples: ToxicSample[]): void {
  const ruleSetV2 = loadJson<{ rules: RuleDSL[] }>('data/rule_experiments/rule_set_v2.json');
  const rules = ruleSetV2.rules;

  const mBlock = evalRuleSet(rules, testSamples, 'block_only');
  const mBlockReview = evalRuleSet(rules, testSamples, 'block_or_review');

  const result = {
    ablation: 'rule_positive_mode',
    split: 'test',
    rule_count: rules.length,
    block_only: {
      precision: +mBlock.precision.toFixed(4),
      recall: +mBlock.recall.toFixed(4),
      f1: +mBlock.f1.toFixed(4),
      accuracy: +mBlock.accuracy.toFixed(4),
      tp: mBlock.confusion.tp,
      fp: mBlock.confusion.fp,
    },
    block_or_review: {
      precision: +mBlockReview.precision.toFixed(4),
      recall: +mBlockReview.recall.toFixed(4),
      f1: +mBlockReview.f1.toFixed(4),
      accuracy: +mBlockReview.accuracy.toFixed(4),
      tp: mBlockReview.confusion.tp,
      fp: mBlockReview.confusion.fp,
    },
  };

  writeFileSync(join(ABL_DIR, 'ablation_positive_mode.json'), JSON.stringify(result, null, 2), 'utf-8');
  console.log('\n=== C. Rule Positive Mode Ablation (test) ===');
  console.log('Mode            | Precision | Recall   | F1       | Accuracy | TP   | FP');
  console.log('----------------+-----------+----------+----------+----------+------+----');
  console.log(
    `block_only      | ${mBlock.precision.toFixed(4).padStart(9)} | ${mBlock.recall.toFixed(4).padStart(8)} | ${mBlock.f1.toFixed(4).padStart(8)} | ${mBlock.accuracy.toFixed(4).padStart(8)} | ${String(mBlock.confusion.tp).padStart(4)} | ${mBlock.confusion.fp}`,
  );
  console.log(
    `block_or_review | ${mBlockReview.precision.toFixed(4).padStart(9)} | ${mBlockReview.recall.toFixed(4).padStart(8)} | ${mBlockReview.f1.toFixed(4).padStart(8)} | ${mBlockReview.accuracy.toFixed(4).padStart(8)} | ${String(mBlockReview.confusion.tp).padStart(4)} | ${mBlockReview.confusion.fp}`,
  );
}

// ========== Main ==========
function main(): void {
  const allCandidates = loadJson<GenCandidate[]>('data/rule_experiments/generated_candidates.json');
  const candidateMetrics = loadJson<CandMetric[]>('data/rule_experiments/candidate_metrics.json');
  const ruleSetV2 = loadJson<{ rules: RuleDSL[] }>('data/rule_experiments/rule_set_v2.json');
  const selectedIds = new Set(ruleSetV2.rules.map((r) => r.rule_id));
  const testSamples = loadJson<ToxicSample[]>('data/datasets/toxicn_test.json');

  ablationRepair(allCandidates);
  ablationCandidateType(allCandidates, candidateMetrics, selectedIds);
  ablationPositiveMode(testSamples);

  console.log('\n\nAll ablation results saved to data/rule_experiments/ablations/');
}

main();

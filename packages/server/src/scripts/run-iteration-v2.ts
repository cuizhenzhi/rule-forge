/**
 * FN-driven rule iteration: generate from v2 tasks, evaluate, select on top of rule_set_v2.
 * Produces rule_set_v3.json (or confirms no improvement).
 * NEVER touches test.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  validateDsl,
  executeRule,
  computeMetrics,
  astComplexity,
  type RuleDSL,
  type FieldDictEntry,
  type OperatorName,
  type BinaryMetrics,
  type AstComplexity,
} from '@ruleforge/dsl-core';
import { createLlmAdapterAsync } from '../services/llm.js';
import { buildGeneratePrompt, buildRepairPrompt } from '../services/prompt.js';
import type { ToxicSample } from './import-toxicn.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const OUT_DIR = join(REPO_ROOT, 'data', 'rule_experiments', 'iteration_v2');

const FIELD_DICT: FieldDictEntry[] = [
  { field: 'content', type: 'string' },
  { field: 'content_norm', type: 'string' },
  { field: 'title', type: 'string' },
  { field: 'author_id', type: 'string' },
];
const OP_WHITELIST: OperatorName[] = [
  'contains_any', 'regex', 'len_gt', 'len_lt', 'in_set', 'not_in_set', 'count_gt',
];

type TaskDef = {
  task_id: string; category: string; nl_text: string;
  candidate_types: string[]; action_type: string; severity: string;
};
type CandRec = {
  task_id: string; candidate_type: string; rule_id: string;
  dsl: RuleDSL | null; validation: { ok: boolean; reached_level: string; repaired: boolean };
};

function extractJson(raw: string): string {
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) return m[1].trim();
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) return raw.slice(first, last + 1);
  return raw.trim();
}

function evalRuleSet(rules: RuleDSL[], samples: ToxicSample[]): BinaryMetrics {
  const preds: number[] = [];
  const labels: number[] = [];
  for (const s of samples) {
    const sample = { content: s.content, content_norm: s.content_norm, title: '', author_id: '' };
    let pred = 0;
    for (const dsl of rules) {
      const res = executeRule(dsl, sample, s.sample_id);
      if (res.final_hit && res.action.type === 'block') { pred = 1; break; }
    }
    preds.push(pred);
    labels.push(s.label);
  }
  return computeMetrics(preds, labels);
}

async function main(): Promise<void> {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const tasks = JSON.parse(readFileSync(
    join(REPO_ROOT, 'data', 'rule_tasks', 'rule_tasks_v2_fn_driven.json'), 'utf-8',
  )) as TaskDef[];

  const llm = await createLlmAdapterAsync();
  const valSamples = JSON.parse(readFileSync(
    join(REPO_ROOT, 'data', 'datasets', 'toxicn_val.json'), 'utf-8',
  )) as ToxicSample[];

  // ===== Step 1: Generate =====
  console.log('=== Step 1: Generate candidates ===');
  const allCandidates: CandRec[] = [];
  const validCandidates: CandRec[] = [];
  let total = 0;
  for (const t of tasks) total += t.candidate_types.length;
  let done = 0;

  for (const task of tasks) {
    for (const ctype of task.candidate_types) {
      done++;
      const ruleId = `${task.task_id}_${ctype}`;
      console.log(`[${done}/${total}] ${ruleId} ...`);

      const prompt = buildGeneratePrompt({
        ruleId, ruleName: task.category, nlText: task.nl_text,
        candidateType: ctype, fieldDict: FIELD_DICT, opWhitelist: OP_WHITELIST,
      });

      let raw: string;
      try { raw = await llm.generate(prompt); } catch (e) {
        console.log(`  LLM error: ${(e as Error).message}`);
        allCandidates.push({ task_id: task.task_id, candidate_type: ctype, rule_id: ruleId, dsl: null, validation: { ok: false, reached_level: 'none', repaired: false } });
        continue;
      }

      let jsonStr = extractJson(raw);
      let result = validateDsl(jsonStr, FIELD_DICT, OP_WHITELIST);
      let repaired = false;

      if (!result.ok) {
        console.log(`  Validation failed (${result.reached_level}), repairing...`);
        try {
          const repairRaw = await llm.generate(buildRepairPrompt({
            badDsl: jsonStr, validatorError: JSON.stringify(result.errors.slice(0, 5)),
            nlText: task.nl_text, fieldDict: FIELD_DICT, opWhitelist: OP_WHITELIST,
          }));
          const repairResult = validateDsl(extractJson(repairRaw), FIELD_DICT, OP_WHITELIST);
          if (repairResult.ok) { result = repairResult; repaired = true; console.log('  Repair OK.'); }
          else console.log(`  Repair failed (${repairResult.reached_level}).`);
        } catch { console.log('  Repair LLM error.'); }
      }

      let dsl: RuleDSL | null = null;
      if (result.ok && result.parsed) {
        dsl = result.parsed;
        dsl.rule_id = ruleId;
        dsl.action = { type: task.action_type as 'block' | 'review' | 'allow', severity: task.severity as 'high' | 'medium' | 'low' };
        if (!dsl.meta) dsl.meta = {};
        dsl.meta.candidate_type = ctype;
        dsl.meta.source = 'llm';
        dsl.meta.task_id = task.task_id;
        dsl.meta.iteration = 'v2_fn_driven';
      }

      const rec: CandRec = { task_id: task.task_id, candidate_type: ctype, rule_id: ruleId, dsl, validation: { ok: result.ok, reached_level: result.reached_level, repaired } };
      allCandidates.push(rec);
      if (dsl) { validCandidates.push(rec); console.log(`  OK${repaired ? ' (repaired)' : ''}`); }
      else console.log(`  FAILED`);
    }
  }

  writeFileSync(join(OUT_DIR, 'generated_candidates_v2.json'), JSON.stringify(allCandidates, null, 2), 'utf-8');
  writeFileSync(join(OUT_DIR, 'validated_candidates_v2.json'), JSON.stringify(validCandidates, null, 2), 'utf-8');
  console.log(`\nGenerated: ${allCandidates.length}, Valid: ${validCandidates.length}`);

  // ===== Step 2: Evaluate each on val =====
  console.log('\n=== Step 2: Evaluate on val ===');
  type CandMetric = { rule_id: string; val_f1: number; val_hits: number; complexity: AstComplexity };
  const candMetrics: CandMetric[] = [];

  for (const c of validCandidates) {
    if (!c.dsl) continue;
    const preds: number[] = [];
    const labels: number[] = [];
    let hits = 0;
    for (const s of valSamples) {
      const sample = { content: s.content, content_norm: s.content_norm, title: '', author_id: '' };
      const res = executeRule(c.dsl, sample, s.sample_id);
      const pred = res.final_hit && res.action.type === 'block' ? 1 : 0;
      if (res.final_hit) hits++;
      preds.push(pred);
      labels.push(s.label);
    }
    const m = computeMetrics(preds, labels);
    const comp = astComplexity(c.dsl.root);
    candMetrics.push({ rule_id: c.rule_id, val_f1: m.f1, val_hits: hits, complexity: comp });
    console.log(`  ${c.rule_id}: val hits=${hits} F1=${m.f1.toFixed(4)}`);
  }
  writeFileSync(join(OUT_DIR, 'candidate_metrics_v2.json'), JSON.stringify(candMetrics, null, 2), 'utf-8');

  // ===== Step 3: Greedy selection starting from v2 =====
  console.log('\n=== Step 3: Greedy selection (v2 → v3) ===');
  const ruleSetV2 = JSON.parse(readFileSync(
    join(REPO_ROOT, 'data', 'rule_experiments', 'rule_set_v2.json'), 'utf-8',
  )) as { rules: RuleDSL[] };

  let currentRules = [...ruleSetV2.rules];
  let currentMetrics = evalRuleSet(currentRules, valSamples);
  console.log(`v2 baseline (${currentRules.length} rules): val F1=${currentMetrics.f1.toFixed(4)}`);

  const eligible = validCandidates
    .filter((c) => c.dsl && candMetrics.find((m) => m.rule_id === c.rule_id && m.val_hits > 0 && m.val_f1 > 0))
    .sort((a, b) => {
      const fa = candMetrics.find((m) => m.rule_id === a.rule_id)?.val_f1 ?? 0;
      const fb = candMetrics.find((m) => m.rule_id === b.rule_id)?.val_f1 ?? 0;
      return fb - fa;
    });

  type Step = { step: number; added: string | null; rules: number; val_f1: number; delta: number };
  const steps: Step[] = [{ step: 0, added: null, rules: currentRules.length, val_f1: currentMetrics.f1, delta: 0 }];
  const existingIds = new Set(currentRules.map((r) => r.rule_id));

  for (const c of eligible) {
    if (!c.dsl || existingIds.has(c.rule_id)) continue;
    const trial = [...currentRules, c.dsl];
    const trialM = evalRuleSet(trial, valSamples);
    const delta = trialM.f1 - currentMetrics.f1;
    if (delta > 0.001) {
      currentRules.push(c.dsl);
      currentMetrics = trialM;
      existingIds.add(c.rule_id);
      steps.push({ step: steps.length, added: c.rule_id, rules: currentRules.length, val_f1: trialM.f1, delta });
      console.log(`  +${c.rule_id}: val F1=${trialM.f1.toFixed(4)} (delta=${delta.toFixed(4)})`);
    }
  }

  const newRulesAdded = currentRules.length - ruleSetV2.rules.length;
  const ruleSetV3 = {
    version: 'v3',
    frozen: true,
    base_version: 'v2',
    iteration: 'fn_driven',
    seed_rule_count: ruleSetV2.rules.length,
    added_rule_count: newRulesAdded,
    total_rule_count: currentRules.length,
    selection_steps: steps,
    rules: currentRules,
  };

  writeFileSync(join(REPO_ROOT, 'data', 'rule_experiments', 'rule_set_v3.json'), JSON.stringify(ruleSetV3, null, 2), 'utf-8');

  console.log('\n=== Selection Summary ===');
  console.log('Step | Added Rule         | Rules | Val F1   | Delta');
  console.log('-----+--------------------+-------+----------+------');
  for (const s of steps) {
    console.log(`  ${String(s.step).padStart(2)} | ${(s.added ?? '(v2 base)').padEnd(18)} | ${String(s.rules).padStart(5)} | ${s.val_f1.toFixed(4).padStart(8)} | ${(s.delta >= 0 ? '+' : '') + s.delta.toFixed(4)}`);
  }
  console.log(`\nv3: ${currentRules.length} rules (v2=${ruleSetV2.rules.length} + ${newRulesAdded} new)`);

  // ===== Compare v2 vs v3 on val =====
  const v2ValM = evalRuleSet(ruleSetV2.rules, valSamples);
  const v3ValM = currentMetrics;
  console.log('\n=== v2 vs v3 on val ===');
  console.log(`  v2: F1=${v2ValM.f1.toFixed(4)} P=${v2ValM.precision.toFixed(4)} R=${v2ValM.recall.toFixed(4)}`);
  console.log(`  v3: F1=${v3ValM.f1.toFixed(4)} P=${v3ValM.precision.toFixed(4)} R=${v3ValM.recall.toFixed(4)}`);

  writeFileSync(join(OUT_DIR, 'v2_vs_v3_val.json'), JSON.stringify({
    v2: { rules: ruleSetV2.rules.length, val_f1: v2ValM.f1, val_precision: v2ValM.precision, val_recall: v2ValM.recall },
    v3: { rules: currentRules.length, val_f1: v3ValM.f1, val_precision: v3ValM.precision, val_recall: v3ValM.recall },
    new_rules_added: newRulesAdded,
    improvement: newRulesAdded > 0,
  }, null, 2), 'utf-8');
}

main().catch((e) => { console.error(e); process.exit(1); });

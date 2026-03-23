/**
 * Generate DSL rule candidates from task definitions via LLM.
 * Validate L1/L2/L3, attempt one repair on failure.
 * Output: data/rule_experiments/generated_candidates.json
 *         data/rule_experiments/validated_candidates.json
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  validateDsl,
  type RuleDSL,
  type FieldDictEntry,
  type OperatorName,
  type FullValidationResult,
} from '@ruleforge/dsl-core';
import { createLlmAdapter } from '../services/llm.js';
import { buildGeneratePrompt, buildRepairPrompt } from '../services/prompt.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

const FIELD_DICT: FieldDictEntry[] = [
  { field: 'content', type: 'string', source: 'raw' },
  { field: 'content_norm', type: 'string', source: 'preprocessing' },
  { field: 'title', type: 'string', source: 'raw' },
  { field: 'author_id', type: 'string', source: 'raw' },
];

const OP_WHITELIST: OperatorName[] = [
  'contains_any', 'regex', 'len_gt', 'len_lt', 'in_set', 'not_in_set', 'count_gt',
];

type TaskDef = {
  task_id: string;
  category: string;
  nl_text: string;
  candidate_types: string[];
  action_type: string;
  severity: string;
};

type CandidateRecord = {
  task_id: string;
  candidate_type: string;
  source: 'llm';
  rule_id: string;
  raw_response: string;
  dsl: RuleDSL | null;
  validation: {
    ok: boolean;
    reached_level: string;
    errors: Array<{ level: string; path: string; message: string; code: string }>;
    repaired: boolean;
    repair_raw?: string;
  };
};

function extractJson(raw: string): string {
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) return m[1].trim();
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) return raw.slice(first, last + 1);
  return raw.trim();
}

function tryValidate(jsonStr: string): FullValidationResult {
  return validateDsl(jsonStr, FIELD_DICT, OP_WHITELIST);
}

async function main(): Promise<void> {
  const tasksPath = join(REPO_ROOT, 'data', 'rule_tasks', 'rule_tasks_v1.json');
  const tasks = JSON.parse(readFileSync(tasksPath, 'utf-8')) as TaskDef[];
  const llm = createLlmAdapter();
  const outDir = join(REPO_ROOT, 'data', 'rule_experiments');

  const allCandidates: CandidateRecord[] = [];
  const validCandidates: CandidateRecord[] = [];

  let total = 0;
  for (const t of tasks) total += t.candidate_types.length;
  let done = 0;

  for (const task of tasks) {
    for (const ctype of task.candidate_types) {
      done++;
      const ruleId = `${task.task_id}_${ctype}`;
      console.log(`[${done}/${total}] ${ruleId} ...`);

      const prompt = buildGeneratePrompt({
        ruleId,
        ruleName: task.category,
        nlText: task.nl_text,
        candidateType: ctype,
        fieldDict: FIELD_DICT,
        opWhitelist: OP_WHITELIST,
      });

      let raw: string;
      try {
        raw = await llm.generate(prompt);
      } catch (e) {
        console.error(`  LLM error: ${(e as Error).message}`);
        allCandidates.push({
          task_id: task.task_id,
          candidate_type: ctype,
          source: 'llm',
          rule_id: ruleId,
          raw_response: `ERROR: ${(e as Error).message}`,
          dsl: null,
          validation: { ok: false, reached_level: 'none', errors: [{ level: 'LLM', path: '$', message: (e as Error).message, code: 'LLM_ERROR' }], repaired: false },
        });
        continue;
      }

      const jsonStr = extractJson(raw);
      let result = tryValidate(jsonStr);
      let repaired = false;
      let repairRaw: string | undefined;

      if (!result.ok) {
        console.log(`  Validation failed (${result.reached_level}), attempting repair...`);
        const repairPrompt = buildRepairPrompt({
          badDsl: jsonStr,
          validatorError: JSON.stringify(result.errors.slice(0, 5)),
          nlText: task.nl_text,
          fieldDict: FIELD_DICT,
          opWhitelist: OP_WHITELIST,
        });

        try {
          repairRaw = await llm.generate(repairPrompt);
          const repairJson = extractJson(repairRaw);
          const repairResult = tryValidate(repairJson);
          if (repairResult.ok) {
            result = repairResult;
            repaired = true;
            console.log('  Repair succeeded.');
          } else {
            console.log(`  Repair still invalid (${repairResult.reached_level}).`);
          }
        } catch (e) {
          console.log(`  Repair LLM error: ${(e as Error).message}`);
        }
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
      }

      const rec: CandidateRecord = {
        task_id: task.task_id,
        candidate_type: ctype,
        source: 'llm',
        rule_id: ruleId,
        raw_response: raw,
        dsl,
        validation: {
          ok: result.ok,
          reached_level: result.reached_level,
          errors: result.errors,
          repaired,
          repair_raw: repairRaw,
        },
      };

      allCandidates.push(rec);
      if (result.ok && dsl) {
        validCandidates.push(rec);
        console.log(`  OK (${result.reached_level}${repaired ? ', repaired' : ''})`);
      } else {
        console.log(`  FAILED (${result.reached_level})`);
      }
    }
  }

  const genPath = join(outDir, 'generated_candidates.json');
  const valPath = join(outDir, 'validated_candidates.json');
  writeFileSync(genPath, JSON.stringify(allCandidates, null, 2), 'utf-8');
  writeFileSync(valPath, JSON.stringify(validCandidates, null, 2), 'utf-8');

  console.log(`\nTotal: ${allCandidates.length}, Valid: ${validCandidates.length}`);
  console.log(`Saved: ${genPath}`);
  console.log(`Saved: ${valPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

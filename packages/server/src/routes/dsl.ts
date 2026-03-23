import { Router } from 'express';
import {
  validateDsl,
  executeRule,
  astToText,
  astComplexity,
  type FieldDictEntry,
  type OperatorName,
  type RuleDSL,
} from '@ruleforge/dsl-core';
import { getDb } from '../db/init.js';
import { createLlmAdapter } from '../services/llm.js';
import { buildGeneratePrompt, buildRepairPrompt } from '../services/prompt.js';

export const dslRouter = Router();

// Helper: load field dict and op whitelist from DB
function loadFieldDict(): FieldDictEntry[] {
  const db = getDb();
  const items = db.prepare(`
    SELECT di.item_key, di.item_type, di.source
    FROM dict_items di
    JOIN dict_sets ds ON ds.id = di.set_id
    WHERE ds.dict_type = 'field_dict' AND ds.status = 'active' AND di.is_active = 1
  `).all() as Array<{ item_key: string; item_type: string; source: string | null }>;

  return items.map(i => ({
    field: i.item_key,
    type: i.item_type as FieldDictEntry['type'],
    source: (i.source as FieldDictEntry['source']) ?? 'raw',
  }));
}

function loadOpWhitelist(): OperatorName[] {
  const db = getDb();
  const items = db.prepare(`
    SELECT di.item_key
    FROM dict_items di
    JOIN dict_sets ds ON ds.id = di.set_id
    WHERE ds.dict_type = 'op_whitelist' AND ds.status = 'active' AND di.is_active = 1
  `).all() as Array<{ item_key: string }>;
  return items.map(i => i.item_key as OperatorName);
}

function loadLexiconSummary(): Record<string, string[]> {
  const db = getDb();
  const sets = db.prepare(
    "SELECT id, name FROM dict_sets WHERE dict_type = 'lexicon' AND status = 'active'"
  ).all() as Array<{ id: string; name: string }>;

  const result: Record<string, string[]> = {};
  for (const s of sets) {
    const items = db.prepare(
      "SELECT item_key FROM dict_items WHERE set_id = ? AND is_active = 1 LIMIT 10"
    ).all(s.id) as Array<{ item_key: string }>;
    result[s.name] = items.map(i => i.item_key);
  }
  return result;
}

// POST /api/dsl/validate
dslRouter.post('/validate', (req, res) => {
  const { dsl } = req.body;
  if (dsl === undefined || dsl === null) {
    res.status(400).json({ error: 'dsl field is required (string or object)' });
    return;
  }

  const fieldDict = loadFieldDict();
  const opWhitelist = loadOpWhitelist();
  const result = validateDsl(dsl, fieldDict, opWhitelist);

  if (result.ok && result.parsed) {
    const text = astToText(result.parsed.root);
    const complexity = astComplexity(result.parsed.root);
    res.json({ ...result, pretty_text: text, complexity });
  } else {
    res.json(result);
  }
});

// POST /api/dsl/execute
dslRouter.post('/execute', (req, res) => {
  const { dsl, samples } = req.body;
  if (!dsl || !samples || !Array.isArray(samples)) {
    res.status(400).json({ error: 'dsl (object) and samples (array) are required' });
    return;
  }

  // Validate first
  const fieldDict = loadFieldDict();
  const opWhitelist = loadOpWhitelist();
  const validation = validateDsl(dsl, fieldDict, opWhitelist);
  if (!validation.ok) {
    res.status(400).json({ error: 'DSL validation failed', validation });
    return;
  }

  const typedDsl = (typeof dsl === 'string' ? JSON.parse(dsl) : dsl) as RuleDSL;
  const results = samples.map((sample: Record<string, unknown>, i: number) => {
    const sampleId = (sample.id as string) ?? `S_${i}`;
    return executeRule(typedDsl, sample, sampleId);
  });

  const summary = {
    total: results.length,
    hits: results.filter(r => r.final_hit).length,
    misses: results.filter(r => !r.final_hit).length,
  };

  res.json({ summary, results });
});

// POST /api/dsl/generate
dslRouter.post('/generate', async (req, res) => {
  const { nl_text, rule_id, rule_name, candidate_type } = req.body;
  if (!nl_text) {
    res.status(400).json({ error: 'nl_text is required' });
    return;
  }

  const fieldDict = loadFieldDict();
  const opWhitelist = loadOpWhitelist();
  const lexiconSummary = loadLexiconSummary();

  const prompt = buildGeneratePrompt({
    ruleId: rule_id ?? 'R_GEN',
    ruleName: rule_name ?? 'Generated Rule',
    nlText: nl_text,
    candidateType: candidate_type ?? 'strict',
    fieldDict,
    opWhitelist,
    lexiconSummary,
  });

  try {
    const adapter = createLlmAdapter();
    const rawOutput = await adapter.generate(prompt);

    // Validate the generated DSL
    const validation = validateDsl(rawOutput, fieldDict, opWhitelist);

    if (validation.ok) {
      const text = astToText(validation.parsed!.root);
      const complexity = astComplexity(validation.parsed!.root);
      res.json({
        success: true,
        dsl: validation.parsed,
        pretty_text: text,
        complexity,
        validation,
        raw_output: rawOutput,
      });
    } else {
      // Attempt repair
      const repairPrompt = buildRepairPrompt({
        badDsl: rawOutput,
        validatorError: JSON.stringify(validation.errors),
        nlText: nl_text,
        fieldDict,
        opWhitelist,
      });

      const repairedOutput = await adapter.generate(repairPrompt);
      const repairValidation = validateDsl(repairedOutput, fieldDict, opWhitelist);

      if (repairValidation.ok) {
        const text = astToText(repairValidation.parsed!.root);
        const complexity = astComplexity(repairValidation.parsed!.root);
        res.json({
          success: true,
          repaired: true,
          dsl: repairValidation.parsed,
          pretty_text: text,
          complexity,
          validation: repairValidation,
          original_errors: validation.errors,
        });
      } else {
        res.json({
          success: false,
          error: 'Generation and repair both failed validation',
          raw_output: rawOutput,
          repaired_output: repairedOutput,
          original_errors: validation.errors,
          repair_errors: repairValidation.errors,
        });
      }
    }
  } catch (e) {
    res.status(500).json({ error: `LLM generation failed: ${(e as Error).message}` });
  }
});

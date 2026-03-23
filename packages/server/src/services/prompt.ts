import type { FieldDictEntry, OperatorName } from '@ruleforge/dsl-core';

export function buildGeneratePrompt(opts: {
  ruleId: string;
  ruleName: string;
  nlText: string;
  candidateType: string;
  fieldDict: FieldDictEntry[];
  opWhitelist: OperatorName[];
  lexiconSummary?: Record<string, string[]>;
}): string {
  const systemPart = `你是一个"规则编译器"，负责把中文文本审核规则翻译为可执行 DSL（AST JSON）。
只输出 JSON，不要输出 markdown 代码块、解释或注释。
输出必须严格符合以下 schema：
{
  "dsl_version": "1.0",
  "rule_id": "string",
  "name": "string",
  "root": { AST node },
  "action": { "type": "block|review|allow", "severity": "high|medium|low" },
  "semantics": { "mode": "boolean" },
  "meta": { "candidate_type": "strict|loose|synonyms", "source": "llm_generated" }
}
AST 节点类型：predicate（叶节点）、and/or（children数组≥2）、not（单个child）。
predicate 结构：{ "node_type":"predicate", "id":"c1", "field":"...", "operator":"...", "value":... }
candidate_type 约束：
- strict：高精度，避免歧义词
- loose：高召回，覆盖更多说法
- synonyms：加入变体/谐音/掩码写法`;

  const fieldDictStr = JSON.stringify(opts.fieldDict.map(f => ({ field: f.field, type: f.type })));
  const opStr = JSON.stringify(opts.opWhitelist);
  const lexStr = opts.lexiconSummary ? JSON.stringify(opts.lexiconSummary) : '无';

  return `${systemPart}

请把下面的审核规则翻译为 DSL。
rule_id: ${opts.ruleId}
rule_name: ${opts.ruleName}
candidate_type: ${opts.candidateType}
规则文本: ${opts.nlText}
字段字典: ${fieldDictStr}
操作符白名单: ${opStr}
可用词表摘要: ${lexStr}
只返回一个 JSON 对象。`;
}

export function buildRepairPrompt(opts: {
  badDsl: string;
  validatorError: string;
  nlText: string;
  fieldDict: FieldDictEntry[];
  opWhitelist: OperatorName[];
}): string {
  const fieldDictStr = JSON.stringify(opts.fieldDict.map(f => ({ field: f.field, type: f.type })));
  const opStr = JSON.stringify(opts.opWhitelist);

  return `你是一个 DSL 修复器。修复下面不合法的 DSL，使其通过校验。
只输出修复后的 JSON，不输出解释。不能发明新字段和操作符。最小修改。

原始 DSL:
${opts.badDsl}

校验错误:
${opts.validatorError}

原始规则文本: ${opts.nlText}
字段字典: ${fieldDictStr}
操作符白名单: ${opStr}
只返回一个 JSON 对象。`;
}

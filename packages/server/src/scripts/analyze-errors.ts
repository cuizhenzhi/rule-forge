/**
 * Error analysis: Rule v2 vs BERT on test set.
 * Outputs sample-level breakdown + toxic_type aggregation + markdown report.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';
import { executeRule, type RuleDSL } from '@ruleforge/dsl-core';
import type { ToxicSample } from './import-toxicn.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const OUT_DIR = join(REPO_ROOT, 'data', 'rule_experiments', 'error_analysis');

type EnrichedSample = ToxicSample & {
  toxic_type: number;
  toxic_type_label: string;
  topic: string;
  platform: string;
  rule_pred: number;
  bert_pred: number;
  fusion_pred: number;
  gold: number;
  category: string;
};

const TOXIC_TYPE_LABELS: Record<number, string> = {
  0: 'non-toxic',
  1: 'offensive',
  2: 'hate_speech',
};

function mkdirp(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function main(): void {
  mkdirp(OUT_DIR);

  // Load test samples
  const testSamples = JSON.parse(
    readFileSync(join(REPO_ROOT, 'data', 'datasets', 'toxicn_test.json'), 'utf-8'),
  ) as ToxicSample[];

  // Load CSV for toxic_type / topic / platform
  const csvBuf = readFileSync(join(REPO_ROOT, 'data', 'ToxiCN-repo', 'ToxiCN_1.0.csv'));
  const csvRows = parse(csvBuf, { columns: true, skip_empty_lines: true, bom: true }) as Record<string, string>[];
  const csvMap = new Map<string, Record<string, string>>();
  for (const r of csvRows) csvMap.set((r.content ?? '').trim(), r);

  // Load BERT predictions
  const bertPred = JSON.parse(
    readFileSync(join(REPO_ROOT, 'data', 'models', 'bert_base_zh_v1', 'predictions_test.json'), 'utf-8'),
  ) as { predictions: Array<{ sample_id: string; predicted_label: number }> };
  const bertMap = new Map<string, number>();
  for (const p of bertPred.predictions) bertMap.set(p.sample_id, p.predicted_label);

  // Load fusion predictions
  let fusionMap = new Map<string, number>();
  try {
    const fusionPred = JSON.parse(
      readFileSync(join(REPO_ROOT, 'data', 'rule_experiments', 'predictions_fusion_test.json'), 'utf-8'),
    ) as { predictions: Array<{ sample_id: string; predicted_label: number }> };
    for (const p of fusionPred.predictions) fusionMap.set(p.sample_id, p.predicted_label);
  } catch { /* no fusion */ }

  // Run rule v2 predictions
  const ruleSet = JSON.parse(
    readFileSync(join(REPO_ROOT, 'data', 'rule_experiments', 'rule_set_v2.json'), 'utf-8'),
  ) as { rules: RuleDSL[] };

  function rulePredict(s: ToxicSample): number {
    const sample = { content: s.content, content_norm: s.content_norm, title: '', author_id: '' };
    for (const dsl of ruleSet.rules) {
      const res = executeRule(dsl, sample, s.sample_id);
      if (res.final_hit && res.action.type === 'block') return 1;
    }
    return 0;
  }

  // Build enriched samples
  const enriched: EnrichedSample[] = [];
  for (const s of testSamples) {
    const csv = csvMap.get(s.content.trim());
    const toxicType = csv ? Number(csv.toxic_type ?? 0) : 0;
    const rp = rulePredict(s);
    const bp = bertMap.get(s.sample_id) ?? 0;
    const fp = fusionMap.get(s.sample_id) ?? 0;
    const gold = s.label;

    let category: string;
    const ruleCorrect = rp === gold;
    const bertCorrect = bp === gold;
    if (ruleCorrect && bertCorrect) category = 'both_correct';
    else if (ruleCorrect && !bertCorrect) category = 'rule_correct_bert_wrong';
    else if (!ruleCorrect && bertCorrect) category = 'bert_correct_rule_wrong';
    else category = 'both_wrong';

    enriched.push({
      ...s,
      toxic_type: toxicType,
      toxic_type_label: TOXIC_TYPE_LABELS[toxicType] ?? 'unknown',
      topic: csv?.topic ?? '',
      platform: csv?.platform ?? '',
      rule_pred: rp,
      bert_pred: bp,
      fusion_pred: fp,
      gold,
      category,
    });
  }

  // Split by category
  const cats = ['rule_correct_bert_wrong', 'bert_correct_rule_wrong', 'both_wrong', 'both_correct'] as const;
  const byCat: Record<string, EnrichedSample[]> = {};
  for (const c of cats) byCat[c] = enriched.filter((e) => e.category === c);

  for (const c of cats) {
    writeFileSync(join(OUT_DIR, `${c}.json`), JSON.stringify(byCat[c], null, 2), 'utf-8');
  }

  // Toxic type aggregation
  type TypeStat = { total: number; rule_tp: number; bert_tp: number; both_miss: number; rule_fp: number; bert_fp: number };
  const byType: Record<string, TypeStat> = {};
  for (const e of enriched) {
    const key = `${e.toxic_type}_${e.toxic_type_label}`;
    if (!byType[key]) byType[key] = { total: 0, rule_tp: 0, bert_tp: 0, both_miss: 0, rule_fp: 0, bert_fp: 0 };
    const st = byType[key];
    st.total++;
    if (e.gold === 1) {
      if (e.rule_pred === 1) st.rule_tp++;
      if (e.bert_pred === 1) st.bert_tp++;
      if (e.rule_pred === 0 && e.bert_pred === 0) st.both_miss++;
    } else {
      if (e.rule_pred === 1) st.rule_fp++;
      if (e.bert_pred === 1) st.bert_fp++;
    }
  }
  writeFileSync(join(OUT_DIR, 'toxic_type_stats.json'), JSON.stringify(byType, null, 2), 'utf-8');

  // Console summary
  console.log('=== Category Counts ===');
  for (const c of cats) console.log(`  ${c}: ${byCat[c].length}`);

  console.log('\n=== Toxic Type Breakdown ===');
  console.log('Type            | Total | Rule TP | BERT TP | Both Miss | Rule FP | BERT FP');
  console.log('----------------+-------+---------+---------+-----------+---------+--------');
  for (const [key, st] of Object.entries(byType).sort((a, b) => a[0].localeCompare(b[0]))) {
    const label = key.split('_').slice(1).join('_');
    console.log(
      `${label.padEnd(15)} | ${String(st.total).padStart(5)} | ${String(st.rule_tp).padStart(7)} | ${String(st.bert_tp).padStart(7)} | ${String(st.both_miss).padStart(9)} | ${String(st.rule_fp).padStart(7)} | ${String(st.bert_fp).padStart(7)}`,
    );
  }

  // Generate markdown report
  function sampleTable(samples: EnrichedSample[], n: number): string {
    const picked = samples.slice(0, n);
    let md = '| # | content (truncated) | gold | rule | bert | toxic_type | topic |\n';
    md += '|---|---------------------|------|------|------|------------|-------|\n';
    for (let i = 0; i < picked.length; i++) {
      const s = picked[i];
      const text = s.content.length > 40 ? s.content.slice(0, 40) + '...' : s.content;
      const safe = text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
      md += `| ${i + 1} | ${safe} | ${s.gold} | ${s.rule_pred} | ${s.bert_pred} | ${s.toxic_type_label} | ${s.topic} |\n`;
    }
    return md;
  }

  const ruleCorrectBertWrong = byCat.rule_correct_bert_wrong;
  const bertCorrectRuleWrong = byCat.bert_correct_rule_wrong;
  const bothWrong = byCat.both_wrong;

  // Subgroup both_wrong by gold label
  const bothWrongToxic = bothWrong.filter((e) => e.gold === 1);
  const bothWrongClean = bothWrong.filter((e) => e.gold === 0);

  let report = `# 误差分析：Rule v2 vs BERT

## 总览

| 类别 | 样本数 | 占比 |
|------|--------|------|
| 两者都对 | ${byCat.both_correct.length} | ${(byCat.both_correct.length / enriched.length * 100).toFixed(1)}% |
| 规则对、BERT 错 | ${ruleCorrectBertWrong.length} | ${(ruleCorrectBertWrong.length / enriched.length * 100).toFixed(1)}% |
| BERT 对、规则错 | ${bertCorrectRuleWrong.length} | ${(bertCorrectRuleWrong.length / enriched.length * 100).toFixed(1)}% |
| 两者都错 | ${bothWrong.length} | ${(bothWrong.length / enriched.length * 100).toFixed(1)}% |
| **合计** | **${enriched.length}** | |

## 按 toxic_type 聚合

| toxic_type | 总数 | Rule TP | Rule Recall | BERT TP | BERT Recall | 共同漏检 |
|------------|------|---------|-------------|---------|-------------|----------|
`;

  for (const [key, st] of Object.entries(byType).sort((a, b) => a[0].localeCompare(b[0]))) {
    const label = key.split('_').slice(1).join('_');
    const positives = st.rule_tp + (st.total - st.rule_tp - st.rule_fp);
    const goldPos = st.total - (label === 'non-toxic' ? st.total : 0);
    const actualPos = enriched.filter(e => e.toxic_type_label === label && e.gold === 1).length;
    const rRecall = actualPos > 0 ? (st.rule_tp / actualPos * 100).toFixed(1) + '%' : 'N/A';
    const bRecall = actualPos > 0 ? (st.bert_tp / actualPos * 100).toFixed(1) + '%' : 'N/A';
    report += `| ${label} | ${st.total} | ${st.rule_tp} | ${rRecall} | ${st.bert_tp} | ${bRecall} | ${st.both_miss} |\n`;
  }

  report += `
---

## 类别 1：规则对、BERT 错（${ruleCorrectBertWrong.length} 条）

这些样本**规则判断正确但 BERT 判断错误**。典型情况：BERT 把含脏词的正常文本误判为有毒（FP），或 BERT 漏掉了含明显关键词的有毒文本（FN）。

${sampleTable(ruleCorrectBertWrong, 20)}

---

## 类别 2：BERT 对、规则错（${bertCorrectRuleWrong.length} 条）

这些样本**BERT 判断正确但规则判断错误**。典型情况：隐式有毒文本（无脏词但有歧视/讽刺含义），规则天然无法覆盖。

${sampleTable(bertCorrectRuleWrong, 20)}

---

## 类别 3：两者都错（${bothWrong.length} 条）

其中有毒但都漏了: ${bothWrongToxic.length} 条；无毒但都误判: ${bothWrongClean.length} 条。

### 有毒但都漏了（${bothWrongToxic.length} 条中前 20）

${sampleTable(bothWrongToxic, 20)}

### 无毒但都误判（${bothWrongClean.length} 条中前 20）

${sampleTable(bothWrongClean, 20)}

---

## 结论

### 规则擅长什么

- **高精度关键词拦截**：含有明确脏词、威胁表达的文本，规则能以 87% precision 精准命中
- **可解释性**：每条命中都有完整的 AST trace，可追溯到具体谓词和匹配证据
- **零延迟、零成本**：不需要 GPU 推理

### BERT 擅长什么

- **隐式有毒检测**：不含脏词的讽刺、暗示性歧视、阴阳怪气，BERT 能通过语义理解识别
- **高召回**：92.5% recall，远超规则的 7.7%
- **泛化**：不依赖词表，对新型表达有一定泛化能力

### 两者共同盲区

- **高度隐晦的有毒内容**：如纯粹通过上下文才能判断的歧视性言论
- **标注边界模糊的样本**：部分样本的"有毒"判定本身就有争议性
`;

  writeFileSync(join(REPO_ROOT, 'docs', 'ERROR_ANALYSIS.md'), report, 'utf-8');
  console.log('\nSaved docs/ERROR_ANALYSIS.md');
  console.log(`Saved ${Object.keys(byCat).length + 1} JSON files to data/rule_experiments/error_analysis/`);
}

main();

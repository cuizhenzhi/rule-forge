# 消融实验结果

三组消融基于同一轮 Kimi LLM 生成的 22 个候选规则和 rule_set_v2（10 条规则）。

## A. Repair 消融

**问题**：LLM 生成的 DSL 校验失败后做一次 repair，是否显著提升通过率？

| 条件 | 通过数 | 通过率 |
|------|--------|--------|
| 不做 repair | 5 / 22 | 22.7% |
| **做 1 次 repair** | **21 / 22** | **95.5%** |

**Repair 挽回 +16 个候选**（从 5 → 21）。唯一失败的 T05_loose 在 repair 后仍无法通过 L1（JSON 格式错误）。

**结论**：一次 repair 机制是 LLM 规则生成流程的关键环节，没有它只有 22.7% 的候选可用。

---

## B. Candidate Type 消融

**问题**：strict / loose / synonyms 三类候选，哪一类对最终选择贡献最大？

| Type | 生成 | 通过 | 通过率 | 被选中 | Avg Precision | Avg Recall | Avg F1 |
|------|------|------|--------|--------|---------------|------------|--------|
| strict | 8 | 8 | 100% | 1 | 0.882 | 0.010 | 0.020 |
| loose | 8 | 7 | 87.5% | 0 | 0.882 | 0.010 | 0.020 |
| **synonyms** | **6** | **6** | **100%** | **3** | **0.838** | **0.024** | **0.045** |

**结论**：synonyms 类候选贡献最大（3/4 条新增规则来自 synonyms），它们覆盖了变体/谐音写法，在 recall 上是 strict 的 2.4 倍。loose 类无一被选入。

---

## C. Rule Positive Mode 消融

**问题**：`block_only` vs `block_or_review` 是否影响 test 指标？

| Mode | Precision | Recall | F1 | Accuracy | TP | FP |
|------|-----------|--------|-----|----------|----|----|
| block_only | 0.8696 | 0.0773 | 0.1420 | 0.4973 | 100 | 15 |
| block_or_review | 0.8696 | 0.0773 | 0.1420 | 0.4973 | 100 | 15 |

结果完全一致。原因：rule_set_v2 中仅 R004 为 review 类型，R004 在 test 上仅命中 1 条样本且该样本已被其他 block 规则覆盖。

**结论**：在当前规则集中 block_only 与 block_or_review 无差异，因为 review 规则覆盖面极窄且被 block 规则完全包含。若未来扩充 review 类规则（如针对"阴阳怪气"等低置信度场景），两种模式将产生差异。

---

## 产物位置

```
data/rule_experiments/ablations/
├── ablation_repair.json
├── ablation_candidate_type.json
└── ablation_positive_mode.json
```

## 命令

```bash
npx tsx packages/server/src/scripts/run-ablations.ts
```

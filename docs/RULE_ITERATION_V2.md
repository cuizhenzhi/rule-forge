# 第二轮 FN 驱动规则迭代

## 动机

rule_set_v2（10 条规则）在 val 上 Recall 仅 8.8%，分析发现 94% 的有毒样本不含任何显式脏词。高频 FN 模式集中在：

- **种族歧视隐语**：将族群比作动物、"嫁给黑人"+贬义
- **性别对立攻击**："女拳""直男癌""国男""倒贴"
- **地域歧视**："域黑""黑河南""黑上海""偷井盖"
- **LGBT 歧视**："基佬""娘炮""恶心"（描述性取向）
- **新型谐音掩码**："紫砂""女醛""÷剩""龌蹉"

## 方法

1. 从 val FN 样本的高频词和模式归纳 5 个新任务（`rule_tasks_v2_fn_driven.json`）
2. 复用实验链：Kimi LLM 生成 → L1/L2/L3 校验 + repair → val 评测 → 贪心选择
3. 以 rule_set_v2 为起点，逐条加入新候选（val F1 增益 > 0.001 才采纳）
4. 冻结为 rule_set_v3，对 test 只跑一次

## 生成统计

| 指标 | 值 |
|------|-----|
| 新任务数 | 5 |
| 候选总数 | 13 |
| 通过校验 | 11 (84.6%) |
| 需要 repair | 9 |
| repair 成功 | 9 |
| 最终选入 | **6** |

## 贪心选择过程（val）

| Step | Added Rule | Rules | Val F1 | Delta |
|------|-----------|-------|--------|-------|
| 0 | (v2 base) | 10 | 0.1583 | — |
| 1 | FN02_loose (性别对立) | 11 | 0.2754 | +0.1171 |
| 2 | FN04_loose (LGBT歧视) | 12 | 0.3130 | +0.0376 |
| 3 | FN01_synonyms (种族隐语) | 13 | 0.3471 | +0.0341 |
| 4 | FN03_strict (地域歧视) | 14 | 0.3842 | +0.0371 |
| 5 | FN01_loose (种族隐语) | 15 | 0.3878 | +0.0036 |
| 6 | FN05_strict (谐音补充) | 16 | 0.4040 | +0.0162 |

最大贡献来自 FN02（性别对立攻击）：单条规则 val 命中 127 条，让 F1 从 0.158 跳到 0.275。

## Test 结果（冻结后一次性评估）

| 版本 | Rules | Test F1 | Precision | Recall | TP | FP |
|------|-------|---------|-----------|--------|----|----|
| v1 (seed) | 6 | 0.006 | 0.571 | 0.003 | 4 | 3 |
| v2 (round 1) | 10 | 0.142 | 0.870 | 0.077 | 100 | 15 |
| **v3 (FN-driven)** | **16** | **0.410** | **0.855** | **0.270** | **349** | **59** |

## 关键数据

- **Test F1 提升**：v2 → v3 = 0.142 → 0.410（**2.9x**）
- **Test Recall 提升**：7.7% → 27.0%（**3.5x**），从 100 → 349 个 TP
- **Precision 维持**：87.0% → 85.5%（仅下降 1.5pp）
- **累计两轮迭代**：v1 → v3 = F1 从 0.006 → 0.410（**68x**）

## 结论

FN 驱动的迭代机制有效：一轮定向补洞将 Recall 提升 3.5 倍，且 Precision 几乎不受影响。这证明"错误分析 → 归纳任务 → LLM 生成 → 校验评测 → 贪心选择"的闭环流程是可迭代的。

## 产物

```
data/rule_tasks/rule_tasks_v2_fn_driven.json          # 5 个 FN 驱动任务
data/rule_experiments/iteration_v2/
├── generated_candidates_v2.json                       # 13 个候选
├── validated_candidates_v2.json                       # 11 个通过
├── candidate_metrics_v2.json                          # val 指标
└── v2_vs_v3_val.json                                  # 对比
data/rule_experiments/rule_set_v3.json                  # 冻结 16 规则
data/rule_experiments/rule_set_v3_test_metrics.json     # test 指标
```

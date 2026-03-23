# 规则生成实验链

## 实验流程

```
rule_tasks_v1.json  (8 tasks x 2-3 types = 22 candidates)
        │
        ▼
[1] generate-rule-candidates.ts    LLM → AST → L1/L2/L3 + 1次 repair
        │
        ├── generated_candidates.json   (全部原始结果)
        └── validated_candidates.json   (通过校验的候选)
        │
        ▼
[2] evaluate-rule-candidates.ts    在 train+val 上逐条评测
        │
        └── candidate_metrics.json      (每条候选的 P/R/F1/hits/complexity)
        │
        ▼
[3] select-rule-set-v2.ts          从 6 seed 开始贪心加规则（val F1 增益 > 0.001）
        │
        └── rule_set_v2.json            (冻结的 v2 规则集)
        │
        ▼
[4] run-rule-set-v2-test.ts        冻结后对 test 跑一次
        │
        └── rule_set_v2_test_metrics.json + DB experiment_runs
```

## 命令

```bash
# Step 1: 生成候选（需要 LLM）
# 使用 Kimi:
KIMI_API_KEY=your_key LLM_PROVIDER=kimi npm run gen:candidates
# 使用 mock（测试流程）:
npm run gen:candidates

# Step 2: 在 train+val 上评测
npm run eval:candidates

# Step 3: 贪心选择（只看 val）
npm run select:v2

# Step 4: 冻结后 test（只跑一次）
npm run test:v2
```

## LLM 配置

| Provider | 环境变量 | 说明 |
|----------|---------|------|
| mock | 默认 | 基于 nl_text 关键词匹配返回预置 DSL，用于验证流程 |
| kimi | `LLM_PROVIDER=kimi` + `KIMI_API_KEY=xxx` | Kimi API，并发上限 20 |
| chattree | `LLM_PROVIDER=chattree` | 本地 ChatTree |

## 产物清单

| 文件 | 位置 | 说明 |
|------|------|------|
| `rule_tasks_v1.json` | `data/rule_tasks/` | 8 个任务定义 |
| `generated_candidates.json` | `data/rule_experiments/` | 全部 LLM 返回 + 校验结果 |
| `validated_candidates.json` | `data/rule_experiments/` | 仅通过 L3 的候选 |
| `candidate_metrics.json` | `data/rule_experiments/` | train+val 和 val 上的逐条指标 |
| `rule_set_v2.json` | `data/rule_experiments/` | 冻结的 v2 规则集 |
| `rule_set_v2_test_metrics.json` | `data/rule_experiments/` | test 最终指标 |

## 约束

- **test 只在 step 4 使用一次**，不参与任何规则开发或选择
- 贪心选择阈值：delta F1 > 0.001 才采纳
- 规则预测策略：block_only（仅 action.type=block 算正预测）
- 候选 DSL 经过 L1→L2→L3 完整校验 + 1 次 repair 机会

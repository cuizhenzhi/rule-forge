# ToxiCN 导入与基线

## 计划文档中的约束（摘要）

- **划分**：ToxiCN 仓库仅有 `ToxiCN_1.0.csv`，无官方 train/val/test 文件 → 默认**全量分层 60/20/20**，seed=42，见 `data/datasets/toxicn_split_manifest.json`。若日后有**官方 train/test**，使用 `--train-csv` / `--test-csv`：**val 仅从官方 train 再切分**，不与 test 混洗。
- **规则基线**：默认仅 **`block` 命中 → 预测违规**；`RULE_POSITIVE_MODE=block_or_review` 可切换。
- **BERT**：默认输入字段 **`content`**；`content_norm` 需单独实验（`--input-field content_norm`）。**阈值**在 `decision_threshold.json` 登记（`fixed_0.5` 或 `val_f1_max`），**冻结后再跑 test**。
- **评估**：规则与 BERT 在 **test** 上使用同一套 gold 与同一 `computeMetrics`（Node 侧注册脚本调用 `@ruleforge/dsl-core`）。

## 命令

```bash
# 1. 数据（需先有 CSV，或 clone ToxiCN 到 data/ToxiCN-repo）
npm run import:toxicn
# 可选：官方 train/test
# npx tsx packages/server/src/scripts/import-toxicn.ts --train-csv path/to/train.csv --test-csv path/to/test.csv

# 2. 规则基线（需已 seed DB，脚本内会 seed）
npm run baseline:rules

# 3. BERT（在仓库根目录，需 Python 依赖）
pip install -r packages/python/requirements.txt
python packages/python/train_bert.py
# 可选：--threshold-mode val_f1
python packages/python/predict_bert.py
npm run register:bert
```

## API

- `GET /api/experiments/compare/summary`：最新 pure_rule vs bert 的 **test** 指标对比。

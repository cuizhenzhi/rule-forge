# Colab BERT Baseline 运行指南

## 前置条件

本地已执行过 `npm run import:toxicn`，`data/datasets/` 下有三个 JSON 文件：

```
data/datasets/toxicn_train.json   (7206 条)
data/datasets/toxicn_val.json     (2402 条)
data/datasets/toxicn_test.json    (2403 条)
```

## 步骤

### 1. 打开 Colab

浏览器访问 <https://colab.research.google.com/>，点击 **Upload notebook**，上传：

```
notebooks/train_bert_colab.ipynb
```

### 2. 选择 GPU

菜单 **Runtime > Change runtime type**，选择 **T4 GPU**（免费）或 **A100**（Colab Pro）。

### 3. 配置 REPO_URL

notebook 第二个 cell 的 `REPO_URL` 已填好：

```
https://github.com/cuizhenzhi/rule-forge.git
```

数据集 JSON 文件已包含在 git 仓库中，clone 后即可直接训练，无需额外上传。

### 4. 运行全部 cell

点击 **Runtime > Run all**。预计用时：

| GPU | 训练 | 预测 |
|-----|------|------|
| T4 | ~30 分钟 | ~2 分钟 |
| A100 | ~15 分钟 | ~1 分钟 |

### 5. 下载产物

最后一个 cell 会自动弹出下载 `bert_artifacts.tar.gz`，包含：

```
data/models/bert_base_zh_v1/
├── metrics_val.json           # val 指标 + 阈值
├── train_config.json          # 超参记录
├── decision_threshold.json    # 冻结阈值
└── predictions_test.json      # test 集逐样本预测
```

### 6. 本地注册

```bash
# 解压到项目根目录（保持 data/models/... 路径）
tar xzf bert_artifacts.tar.gz -C "g:\新建文件夹 (6)\rule-forge\"

# 注册到 DB 并计算 test 指标
npm run register:bert
```

注册完成后启动 server（`npm run dev:server`），访问 Dashboard 即可看到规则 vs BERT 的 test 指标对比。

## 常见问题

**Q: Colab 提示 `eval_strategy` 报错？**
A: 已修复。如果仍报错，说明 transformers 版本 < 4.41，将 `train_bert.py` 中的 `eval_strategy` 改为 `evaluation_strategy`。

**Q: 上传 JSON 文件太慢？**
A: 先压缩：`tar czf datasets.tar.gz -C data/datasets .`，上传后在 Colab 解压：`!tar xzf datasets.tar.gz -C data/datasets/`。

**Q: 想用全量模型权重（不只是 metrics）？**
A: 修改 notebook 最后的打包 cell，把整个 `data/models/bert_base_zh_v1/` 目录加入 tar。文件约 400MB。

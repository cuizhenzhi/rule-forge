#!/usr/bin/env python3
"""BERT inference on test JSON only. Uses frozen decision_threshold.json from train step."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer


def load_json(path: Path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-dir", type=Path, default=Path("data/models/bert_base_zh_v1"))
    ap.add_argument("--test-json", type=Path, default=Path("data/datasets/toxicn_test.json"))
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args()

    out = args.out or (args.model_dir / "predictions_test.json")
    cfg_path = args.model_dir / "decision_threshold.json"
    if not cfg_path.exists():
        raise SystemExit(f"Missing {cfg_path}; run train_bert.py first.")
    thr_cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    threshold = float(thr_cfg["decision_threshold"])
    field = thr_cfg.get("bert_input_field", "content")

    rows = load_json(args.test_json)
    tokenizer = AutoTokenizer.from_pretrained(str(args.model_dir))
    model = AutoModelForSequenceClassification.from_pretrained(str(args.model_dir))
    model.eval()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device)

    results = []
    batch_size = 32
    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        texts = [b.get(field) or "" for b in batch]
        enc = tokenizer(
            texts,
            truncation=True,
            max_length=128,
            padding=True,
            return_tensors="pt",
        )
        enc = {k: v.to(device) for k, v in enc.items()}
        with torch.no_grad():
            logits = model(**enc).logits.cpu().numpy()
        e = np.exp(logits - logits.max(axis=1, keepdims=True))
        prob1 = (e / e.sum(axis=1, keepdims=True))[:, 1]
        for j, r in enumerate(batch):
            p = float(prob1[j])
            results.append(
                {
                    "sample_id": r["sample_id"],
                    "prob_non_compliant": p,
                    "predicted_label": 1 if p >= threshold else 0,
                    "gold_label": int(r["label"]),
                }
            )

    payload = {
        "split": "test",
        "decision_threshold": threshold,
        "threshold_source": thr_cfg.get("threshold_source"),
        "bert_input_field": field,
        "predictions": results,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {out} ({len(results)} samples)")


if __name__ == "__main__":
    main()

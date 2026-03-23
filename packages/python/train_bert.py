#!/usr/bin/env python3
"""
Fine-tune bert-base-chinese on ToxiCN JSON splits.
- Train: train.json only. Val: early stopping / threshold selection only.
- Default input field: content (use content_norm only as separate experiment via --input-field).
- Threshold: --threshold-mode fixed (0.5) or val_f1 (best F1 on val, frozen before test).
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import numpy as np
import torch
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score
from torch.utils.data import Dataset
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    Trainer,
    TrainingArguments,
)


def load_json(path: Path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))


class JsonDataset(Dataset):
    def __init__(self, rows: list[dict], tokenizer, max_len: int, field: str):
        self.rows = rows
        self.tokenizer = tokenizer
        self.max_len = max_len
        self.field = field

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, i):
        r = self.rows[i]
        text = r.get(self.field) or ""
        enc = self.tokenizer(
            text,
            truncation=True,
            max_length=self.max_len,
            padding="max_length",
            return_tensors="pt",
        )
        item = {k: v.squeeze(0) for k, v in enc.items()}
        item["labels"] = torch.tensor(int(r["label"]), dtype=torch.long)
        return item


def compute_metrics_eval(pred):
    logits = pred.predictions
    labels = pred.label_ids
    preds = np.argmax(logits, axis=-1)
    return {
        "accuracy": accuracy_score(labels, preds),
        "f1": f1_score(labels, preds, zero_division=0),
        "precision": precision_score(labels, preds, zero_division=0),
        "recall": recall_score(labels, preds, zero_division=0),
    }


def probs_positive(logits: np.ndarray) -> np.ndarray:
    """Probability of class 1 (non_compliant) from 2-class logits."""
    e = np.exp(logits - logits.max(axis=1, keepdims=True))
    p = e / e.sum(axis=1, keepdims=True)
    return p[:, 1]


def best_threshold_f1(probs: np.ndarray, labels: np.ndarray) -> tuple[float, float]:
    best_t, best_f1 = 0.5, 0.0
    for t in np.linspace(0.05, 0.95, 19):
        pred = (probs >= t).astype(int)
        f1 = f1_score(labels, pred, zero_division=0)
        if f1 > best_f1:
            best_f1, best_t = f1, float(t)
    return best_t, best_f1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--train-json", type=Path, default=Path("data/datasets/toxicn_train.json"))
    ap.add_argument("--val-json", type=Path, default=Path("data/datasets/toxicn_val.json"))
    ap.add_argument("--out-dir", type=Path, default=Path("data/models/bert_base_zh_v1"))
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--epochs", type=int, default=3)
    ap.add_argument("--batch-size", type=int, default=16)
    ap.add_argument("--lr", type=float, default=2e-5)
    ap.add_argument("--max-length", type=int, default=128)
    ap.add_argument("--input-field", type=str, default="content", choices=("content", "content_norm"))
    ap.add_argument(
        "--threshold-mode",
        type=str,
        default="fixed",
        choices=("fixed", "val_f1"),
        help="fixed=0.5; val_f1=threshold maximizing F1 on val (frozen before test)",
    )
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    np.random.seed(args.seed)

    train_rows = load_json(args.train_json)
    val_rows = load_json(args.val_json)
    model_name = "bert-base-chinese"
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    model = AutoModelForSequenceClassification.from_pretrained(model_name, num_labels=2)

    train_ds = JsonDataset(train_rows, tokenizer, args.max_length, args.input_field)
    val_ds = JsonDataset(val_rows, tokenizer, args.max_length, args.input_field)

    args.out_dir.mkdir(parents=True, exist_ok=True)

    training_args = TrainingArguments(
        output_dir=str(args.out_dir / "checkpoints"),
        learning_rate=args.lr,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size,
        num_train_epochs=args.epochs,
        eval_strategy="epoch",
        save_strategy="epoch",
        load_best_model_at_end=True,
        metric_for_best_model="f1",
        greater_is_better=True,
        seed=args.seed,
        logging_steps=50,
        report_to=[],
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_ds,
        eval_dataset=val_ds,
        compute_metrics=compute_metrics_eval,
    )
    trainer.train()

    # Val logits for threshold
    val_pred = trainer.predict(val_ds)
    val_logits = val_pred.predictions
    val_labels = val_pred.label_ids
    val_probs = probs_positive(val_logits)

    if args.threshold_mode == "fixed":
        decision_threshold = 0.5
        threshold_source = "fixed_0.5"
    else:
        decision_threshold, val_f1_at_t = best_threshold_f1(val_probs, val_labels)
        threshold_source = "val_f1_max"

    val_pred_bin = (val_probs >= decision_threshold).astype(int)
    metrics_val = {
        "split": "val",
        "accuracy": float(accuracy_score(val_labels, val_pred_bin)),
        "precision": float(precision_score(val_labels, val_pred_bin, zero_division=0)),
        "recall": float(recall_score(val_labels, val_pred_bin, zero_division=0)),
        "f1": float(f1_score(val_labels, val_pred_bin, zero_division=0)),
        "decision_threshold": decision_threshold,
        "threshold_source": threshold_source,
    }

    train_config = {
        "model_name": model_name,
        "bert_input_field": args.input_field,
        "seed": args.seed,
        "epochs": args.epochs,
        "batch_size": args.batch_size,
        "lr": args.lr,
        "max_length": args.max_length,
        "threshold_mode": args.threshold_mode,
        "decision_threshold": decision_threshold,
        "threshold_source": threshold_source,
        "train_json": str(args.train_json.resolve()),
        "val_json": str(args.val_json.resolve()),
    }

    trainer.save_model(str(args.out_dir))
    tokenizer.save_pretrained(str(args.out_dir))

    (args.out_dir / "metrics_val.json").write_text(json.dumps(metrics_val, indent=2), encoding="utf-8")
    (args.out_dir / "train_config.json").write_text(json.dumps(train_config, indent=2), encoding="utf-8")
    (args.out_dir / "decision_threshold.json").write_text(
        json.dumps(
            {
                "decision_threshold": decision_threshold,
                "threshold_source": threshold_source,
                "bert_input_field": args.input_field,
                "frozen_before_test": True,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(json.dumps({"saved": str(args.out_dir), **train_config}, indent=2))


if __name__ == "__main__":
    main()

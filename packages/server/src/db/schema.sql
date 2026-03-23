-- RuleForge Core Schema (SQLite)

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  username    TEXT NOT NULL UNIQUE,
  role        TEXT NOT NULL DEFAULT 'reviewer' CHECK(role IN ('admin','reviewer','engineer')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rules (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  scope       TEXT NOT NULL DEFAULT 'content_moderation',
  owner_user_id TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (owner_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS rule_versions (
  id                TEXT PRIMARY KEY,
  rule_id           TEXT NOT NULL,
  version_no        INTEGER NOT NULL DEFAULT 1,
  nl_text           TEXT NOT NULL,
  candidate_type    TEXT NOT NULL DEFAULT 'strict' CHECK(candidate_type IN ('strict','loose','synonyms','manual')),
  dsl_json          TEXT,
  validation_status TEXT DEFAULT 'draft' CHECK(validation_status IN ('draft','generated','validated','published','archived','repair_failed')),
  validation_errors TEXT,
  is_published      INTEGER NOT NULL DEFAULT 0,
  created_by        TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (rule_id) REFERENCES rules(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  UNIQUE(rule_id, version_no)
);

CREATE TABLE IF NOT EXISTS dict_sets (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  dict_type   TEXT NOT NULL CHECK(dict_type IN ('field_dict','op_whitelist','lexicon','regex_set','synonym_set')),
  language    TEXT NOT NULL DEFAULT 'zh',
  version     TEXT NOT NULL DEFAULT 'v1',
  status      TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('draft','active','archived')),
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dict_items (
  id              TEXT PRIMARY KEY,
  set_id          TEXT NOT NULL,
  item_key        TEXT NOT NULL,
  item_label      TEXT,
  item_type       TEXT,
  value_json      TEXT,
  normalized_form TEXT,
  priority        INTEGER DEFAULT 0,
  severity        TEXT,
  source          TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1,
  note            TEXT,
  FOREIGN KEY (set_id) REFERENCES dict_sets(id)
);

CREATE TABLE IF NOT EXISTS datasets (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL UNIQUE,
  source            TEXT NOT NULL,
  task_type         TEXT NOT NULL DEFAULT 'binary_compliance',
  file_path         TEXT NOT NULL,
  file_hash         TEXT NOT NULL,
  language          TEXT NOT NULL DEFAULT 'zh',
  label_schema_json TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dataset_splits (
  id            TEXT PRIMARY KEY,
  dataset_id    TEXT NOT NULL,
  split_name    TEXT NOT NULL CHECK(split_name IN ('train','val','test')),
  split_path    TEXT NOT NULL,
  file_hash     TEXT NOT NULL,
  sample_count  INTEGER,
  split_seed    TEXT,
  FOREIGN KEY (dataset_id) REFERENCES datasets(id),
  UNIQUE(dataset_id, split_name)
);

CREATE TABLE IF NOT EXISTS model_versions (
  id                TEXT PRIMARY KEY,
  dataset_id        TEXT,
  name              TEXT NOT NULL,
  framework         TEXT NOT NULL DEFAULT 'huggingface',
  artifact_path     TEXT NOT NULL,
  metrics_json      TEXT,
  data_hash         TEXT,
  seed              INTEGER,
  train_config_json TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (dataset_id) REFERENCES datasets(id)
);

CREATE TABLE IF NOT EXISTS experiment_runs (
  id                TEXT PRIMARY KEY,
  dataset_split_id  TEXT,
  model_version_id  TEXT,
  fusion_config_json TEXT,
  seed              INTEGER,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','success','failed')),
  created_by        TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (dataset_split_id) REFERENCES dataset_splits(id),
  FOREIGN KEY (model_version_id) REFERENCES model_versions(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS experiment_run_rules (
  id                TEXT PRIMARY KEY,
  experiment_run_id TEXT NOT NULL,
  rule_version_id   TEXT NOT NULL,
  rule_order        INTEGER NOT NULL DEFAULT 0,
  role              TEXT NOT NULL DEFAULT 'candidate' CHECK(role IN ('candidate','selected','final')),
  FOREIGN KEY (experiment_run_id) REFERENCES experiment_runs(id),
  FOREIGN KEY (rule_version_id) REFERENCES rule_versions(id)
);

CREATE TABLE IF NOT EXISTS experiment_metrics (
  id                TEXT PRIMARY KEY,
  experiment_run_id TEXT NOT NULL,
  metric_scope      TEXT NOT NULL CHECK(metric_scope IN ('rule','rule_set','model','fusion','generation')),
  metric_name       TEXT NOT NULL,
  metric_value      REAL NOT NULL,
  extra_json        TEXT,
  FOREIGN KEY (experiment_run_id) REFERENCES experiment_runs(id)
);

CREATE TABLE IF NOT EXISTS case_explanations (
  id                TEXT PRIMARY KEY,
  experiment_run_id TEXT NOT NULL,
  sample_id         TEXT NOT NULL,
  final_label       TEXT NOT NULL,
  final_source      TEXT NOT NULL CHECK(final_source IN ('rule','model','fusion')),
  rule_trace_json   TEXT,
  model_score       REAL,
  version_refs_json TEXT,
  error_tag         TEXT,
  FOREIGN KEY (experiment_run_id) REFERENCES experiment_runs(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  payload_json TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_rule_versions_rule_id ON rule_versions(rule_id);
CREATE INDEX IF NOT EXISTS idx_dict_items_set_id ON dict_items(set_id);
CREATE INDEX IF NOT EXISTS idx_experiment_run_rules_run_id ON experiment_run_rules(experiment_run_id);
CREATE INDEX IF NOT EXISTS idx_experiment_metrics_run_id ON experiment_metrics(experiment_run_id);
CREATE INDEX IF NOT EXISTS idx_case_explanations_run_id ON case_explanations(experiment_run_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_type, target_id);

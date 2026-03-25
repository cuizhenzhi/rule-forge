const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as Record<string, string>).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getRules: () => request<{ rules: RuleRow[] }>('/rules'),

  getRule: (id: string) => request<{ rule: RuleRow; versions: RuleVersionRow[] }>(`/rules/${id}`),

  createRule: (data: { code: string; name: string; scope?: string }) =>
    request<{ rule_id: string }>('/rules', { method: 'POST', body: JSON.stringify(data) }),

  createVersion: (ruleId: string, data: { nl_text: string; candidate_type?: string; dsl_json?: unknown }) =>
    request<{ version_id: string; version_no: number }>(`/rules/${ruleId}/versions`, { method: 'POST', body: JSON.stringify(data) }),

  validateDsl: (dsl: unknown) =>
    request<ValidationResponse>('/dsl/validate', { method: 'POST', body: JSON.stringify({ dsl }) }),

  executeDsl: (dsl: unknown, samples: Record<string, unknown>[]) =>
    request<ExecuteResponse>('/dsl/execute', { method: 'POST', body: JSON.stringify({ dsl, samples }) }),

  generateDsl: (data: { nl_text: string; rule_id?: string; rule_name?: string; candidate_type?: string }) =>
    request<GenerateResponse>('/dsl/generate', { method: 'POST', body: JSON.stringify(data) }),

  getDicts: (type: string) => request<{ dict_sets: DictSet[] }>(`/rules/dicts/${type}`),

  getExperimentCompare: () =>
    request<ExperimentCompareResponse>('/experiments/compare/summary'),
};

// --- Types ---

export type RuleRow = {
  id: string;
  code: string;
  name: string;
  scope: string;
  created_at: string;
  updated_at: string;
  latest_version_id: string | null;
  version_no: number | null;
  candidate_type: string | null;
  validation_status: string | null;
  is_published: number | null;
  nl_text: string | null;
};

export type RuleVersionRow = {
  id: string;
  rule_id: string;
  version_no: number;
  nl_text: string;
  candidate_type: string;
  dsl_json: string | null;
  validation_status: string;
  validation_errors: string | null;
  is_published: number;
  created_at: string;
};

export type ValidationResponse = {
  ok: boolean;
  errors: Array<{ level: string; path: string; message: string; code: string }>;
  reached_level: string;
  pretty_text?: string;
  complexity?: { nodeCount: number; depth: number; predicateCount: number };
};

export type ExecuteResponse = {
  summary: { total: number; hits: number; misses: number };
  results: Array<{
    rule_id: string;
    sample_id: string;
    final_hit: boolean;
    action: { type: string; severity: string };
    trace: TraceNodeData;
  }>;
};

export type TraceNodeData = {
  node_id: string;
  node_type: string;
  status: 'evaluated' | 'skipped';
  result: boolean | null;
  evidence?: Record<string, unknown> | null;
  children?: TraceNodeData[];
  child?: TraceNodeData;
};

export type GenerateResponse = {
  success: boolean;
  dsl?: unknown;
  pretty_text?: string;
  complexity?: { nodeCount: number; depth: number; predicateCount: number };
  error?: string;
  raw_output?: string;
  repaired?: boolean;
  original_errors?: unknown[];
};

type ExperimentEntry = {
  experiment_run_id: string;
  config: Record<string, unknown> | null;
  test_metrics: Record<string, number>;
};

export type ExperimentCompareResponse = {
  disclaimer: string;
  pure_rule: ExperimentEntry | null;
  bert: ExperimentEntry | null;
  fusion: ExperimentEntry | null;
};

export type DictSet = {
  id: string;
  name: string;
  dict_type: string;
  items: Array<{ item_key: string; item_label: string; item_type: string }>;
};

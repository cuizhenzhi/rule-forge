import type { RuleDSL } from '@ruleforge/dsl-core';

// --- Adapter Interface ---

export interface LlmAdapter {
  generate(prompt: string): Promise<string>;
}

// --- Mock Adapter: keyed by nl_text pattern ---

const MOCK_RULES: Array<{ pattern: RegExp; dsl: RuleDSL }> = [
  {
    pattern: /威胁/,
    dsl: {
      dsl_version: '1.0', rule_id: 'R_GEN', name: '威胁表达拦截',
      root: { node_type: 'predicate', id: 'c1', field: 'content', operator: 'regex', value: '(弄死你|杀了你|打死你|砍死你)' },
      action: { type: 'block', severity: 'high' },
      semantics: { mode: 'boolean' },
      meta: { candidate_type: 'strict', source: 'llm_generated' },
    },
  },
  {
    pattern: /辱骂|骂/,
    dsl: {
      dsl_version: '1.0', rule_id: 'R_GEN', name: '辱骂词拦截',
      root: { node_type: 'predicate', id: 'c1', field: 'content_norm', operator: 'contains_any', value: ['傻逼', '脑残', '废物', '智障', '白痴'] },
      action: { type: 'block', severity: 'high' },
      semantics: { mode: 'boolean' },
      meta: { candidate_type: 'strict', source: 'llm_generated' },
    },
  },
  {
    pattern: /变体|谐音|掩码/,
    dsl: {
      dsl_version: '1.0', rule_id: 'R_GEN', name: '辱骂变体拦截',
      root: { node_type: 'predicate', id: 'c1', field: 'content', operator: 'regex', value: '(傻.{0,2}逼|沙比|脑.?残|智.?障)' },
      action: { type: 'block', severity: 'high' },
      semantics: { mode: 'boolean' },
      meta: { candidate_type: 'synonyms', source: 'llm_generated' },
    },
  },
  {
    pattern: /次数|累计|频次/,
    dsl: {
      dsl_version: '1.0', rule_id: 'R_GEN', name: '累计命中拦截',
      root: { node_type: 'predicate', id: 'c1', field: 'content_norm', operator: 'count_gt', value: { target: '垃圾', threshold: 1 } },
      action: { type: 'review', severity: 'medium' },
      semantics: { mode: 'boolean' },
      meta: { candidate_type: 'strict', source: 'llm_generated' },
    },
  },
];

export class MockLlmAdapter implements LlmAdapter {
  async generate(prompt: string): Promise<string> {
    for (const entry of MOCK_RULES) {
      if (entry.pattern.test(prompt)) {
        return JSON.stringify(entry.dsl, null, 2);
      }
    }
    // Default fallback
    return JSON.stringify(MOCK_RULES[1].dsl, null, 2);
  }
}

// --- ChatTree Adapter ---

export class ChatTreeAdapter implements LlmAdapter {
  private baseUrl: string;

  constructor(baseUrl = 'http://localhost:3083') {
    this.baseUrl = baseUrl;
  }

  async generate(prompt: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/v2/entity-query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        skipRound2: true,
      }),
    });

    if (!res.ok) {
      throw new Error(`ChatTree API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json() as Record<string, unknown>;
    const result = data.result as Record<string, unknown> | undefined;
    const text = result?.cleanedAssistantMessage ?? result?.assistantMessage;

    if (typeof text !== 'string') {
      throw new Error('ChatTree returned no assistant message');
    }

    // Extract JSON from response (LLM may wrap in markdown code blocks)
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    return jsonMatch ? jsonMatch[1].trim() : text.trim();
  }
}

// --- Factory ---

export function createLlmAdapter(): LlmAdapter {
  const provider = process.env.LLM_PROVIDER ?? 'mock';
  switch (provider) {
    case 'chattree':
      return new ChatTreeAdapter(process.env.CHATTREE_URL);
    case 'mock':
    default:
      return new MockLlmAdapter();
  }
}

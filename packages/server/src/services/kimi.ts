/**
 * Kimi LLM adapter with concurrency control.
 */
import type { LlmAdapter } from './llm.js';

const KIMI_BASE_URL = 'https://api.kimi.com/coding/v1';
const KIMI_MODEL = 'kimi-for-coding';

const DISGUISE_HEADERS = {
  'User-Agent': 'claude-code/0.1.0',
  'Referer': 'https://code.claude.ai/',
  'Origin': 'https://code.claude.ai',
  'anthropic-version': '2023-06-01',
};

class Semaphore {
  private queue: Array<() => void> = [];
  private running = 0;
  constructor(private max: number) {}
  async acquire(): Promise<void> {
    if (this.running < this.max) {
      this.running++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
  }
  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) {
      this.running++;
      next();
    }
  }
}

const globalSem = new Semaphore(20);

export class KimiAdapter implements LlmAdapter {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.KIMI_API_KEY || '';
    if (!this.apiKey) throw new Error('KIMI_API_KEY required');
  }

  async generate(prompt: string): Promise<string> {
    await globalSem.acquire();
    try {
      return await this.call(prompt);
    } finally {
      globalSem.release();
    }
  }

  private async call(prompt: string, retries = 2): Promise<string> {
    const payload = {
      model: KIMI_MODEL,
      messages: [{ role: 'user', content: prompt }],
      system: 'You are Kimi, a helpful coding assistant.',
      max_tokens: 4096,
      temperature: 0.7,
      stream: false,
    };

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const resp = await fetch(`${KIMI_BASE_URL}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
            ...DISGUISE_HEADERS,
          },
          body: JSON.stringify(payload),
        });

        if (resp.status === 429 || resp.status >= 500) {
          const wait = Math.pow(2, attempt) * 1000 + Math.random() * 500;
          console.warn(`Kimi ${resp.status}, retry in ${Math.round(wait)}ms...`);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }

        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(`Kimi API error (${resp.status}): ${text}`);
        }

        const data = (await resp.json()) as Record<string, unknown>;
        if (data.content && Array.isArray(data.content)) {
          return (data.content as Array<{ type: string; text: string }>)
            .filter((b) => b.type === 'text')
            .map((b) => b.text)
            .join('');
        }
        return JSON.stringify(data);
      } catch (e) {
        if (attempt === retries) throw e;
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
    throw new Error('Kimi: all retries exhausted');
  }
}

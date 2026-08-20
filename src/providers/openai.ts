/**
 * OpenAI provider — server-side only. Requires OPENAI_API_KEY.
 */
import { GenerateInput, GenerateResult, ProviderAdapter, ProviderStatus } from './adapter';
import { INPUT_LIMITS } from '../security/inputSecurity';

const ALLOWED_OPENAI_MODELS = new Set(['gpt-4o-mini', 'gpt-4o']);

export class OpenAiProvider implements ProviderAdapter {
  id = 'openai';

  status(): ProviderStatus {
    return process.env.OPENAI_API_KEY ? 'CONFIGURED' : 'NOT_CONFIGURED';
  }

  capabilities(): string[] {
    return ['chat', 'completion'];
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    if (!process.env.OPENAI_API_KEY) {
      return { ok: false, detail: 'OPENAI_API_KEY not configured' };
    }
    try {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        signal: AbortSignal.timeout(8000),
      });
      return res.ok
        ? { ok: true, detail: 'OpenAI API reachable' }
        : { ok: false, detail: `OpenAI health check failed (${res.status})` };
    } catch (e: any) {
      return { ok: false, detail: e.message || 'OpenAI unreachable' };
    }
  }

  estimateCost(input: GenerateInput): number {
    // Rough pilot estimate only — not billing
    const chars = input.prompt.length;
    return Math.round((chars / 1000) * 0.001 * 10000) / 10000;
  }

  async generate(input: GenerateInput): Promise<GenerateResult> {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      throw Object.assign(new Error('OPENAI_API_KEY not configured'), { code: 'PROVIDER_NOT_CONFIGURED' });
    }
    if (!ALLOWED_OPENAI_MODELS.has(input.modelId)) {
      throw Object.assign(new Error(`Model ${input.modelId} not allowlisted for OpenAI`), {
        code: 'MODEL_NOT_ALLOWED',
      });
    }

    const started = Date.now();
    const timeoutMs = input.timeoutMs ?? INPUT_LIMITS.inferenceTimeoutMs;
    const maxTokens = Math.min(input.maxOutputTokens ?? 1024, INPUT_LIMITS.maxOutputTokensDefault);

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: input.modelId,
        messages: [{ role: 'user', content: input.prompt.slice(0, INPUT_LIMITS.maxPromptChars) }],
        max_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const data = (await res.json()) as {
      error?: { message?: string };
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    if (!res.ok) {
      throw Object.assign(new Error(data.error?.message || `OpenAI error ${res.status}`), {
        code: 'PROVIDER_UNAVAILABLE',
      });
    }

    const output = data.choices?.[0]?.message?.content ?? '';
    return {
      output,
      inputTokens: data.usage?.prompt_tokens,
      outputTokens: data.usage?.completion_tokens,
      durationMs: Date.now() - started,
      providerId: 'openai',
      modelId: input.modelId,
    };
  }
}

export const openAiProvider = new OpenAiProvider();

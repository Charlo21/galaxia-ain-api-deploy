/**
 * Provider adapter interface — all execution server-side.
 */
import { openAiProvider } from './openai';

export type ProviderStatus = 'LIVE' | 'CONFIGURED' | 'NOT_CONFIGURED' | 'DISABLED' | 'SIMULATED';

export type GenerateInput = {
  modelId: string;
  prompt: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
};

export type GenerateResult = {
  output: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs: number;
  providerId: string;
  modelId: string;
};

export interface ProviderAdapter {
  id: string;
  status(): ProviderStatus;
  health(): Promise<{ ok: boolean; detail: string }>;
  generate(input: GenerateInput): Promise<GenerateResult>;
  estimateCost?(input: GenerateInput): number;
  capabilities(): string[];
}

export class NotConfiguredProvider implements ProviderAdapter {
  constructor(
    public id: string,
    private reason: string
  ) {}
  status(): ProviderStatus {
    return 'NOT_CONFIGURED';
  }
  async health() {
    return { ok: false, detail: this.reason };
  }
  async generate(): Promise<GenerateResult> {
    throw Object.assign(new Error(this.reason), { code: 'PROVIDER_NOT_CONFIGURED' });
  }
  capabilities() {
    return [];
  }
}

export function getProviderAdapter(providerId: string): ProviderAdapter {
  switch (providerId) {
    case 'openai':
      return process.env.OPENAI_API_KEY
        ? openAiProvider
        : new NotConfiguredProvider('openai', 'OPENAI_API_KEY not configured');
    case 'anthropic':
      return process.env.ANTHROPIC_API_KEY
        ? new NotConfiguredProvider('anthropic', 'Anthropic adapter not yet implemented')
        : new NotConfiguredProvider('anthropic', 'ANTHROPIC_API_KEY not configured');
    case 'galaxia-docker':
      return process.env.DOCKER_INFERENCE_ENABLED === 'false'
        ? new NotConfiguredProvider('galaxia-docker', 'Docker inference disabled')
        : new NotConfiguredProvider('galaxia-docker', 'Docker inference worker not wired to tenant API');
    default:
      return new NotConfiguredProvider(providerId, 'Unknown provider');
  }
}

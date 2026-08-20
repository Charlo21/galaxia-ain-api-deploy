/**
 * Server-side provider registry — honest classification only.
 */
import { ErrorCodes } from './apiErrors';

export type ProviderState =
  | 'LIVE'
  | 'CONFIGURED'
  | 'SIMULATED'
  | 'NOT_CONFIGURED'
  | 'DISABLED';

export type ModelEntry = {
  id: string;
  provider: string;
  state: ProviderState;
  costClass: 'standard' | 'premium' | 'local-docker';
  maxContextTokens: number;
  enabled: boolean;
};

const DOCKER_MODELS: ModelEntry[] = [
  {
    id: 'llama-3-8b',
    provider: 'galaxia-docker',
    state: 'CONFIGURED',
    costClass: 'local-docker',
    maxContextTokens: 8192,
    enabled: true,
  },
  {
    id: 'stable-diffusion',
    provider: 'galaxia-docker',
    state: 'CONFIGURED',
    costClass: 'local-docker',
    maxContextTokens: 0,
    enabled: true,
  },
  {
    id: 'whisper',
    provider: 'galaxia-docker',
    state: 'CONFIGURED',
    costClass: 'local-docker',
    maxContextTokens: 0,
    enabled: true,
  },
];

const OPENAI_MODELS: ModelEntry[] = [
  {
    id: 'gpt-4o-mini',
    provider: 'openai',
    state: 'CONFIGURED',
    costClass: 'standard',
    maxContextTokens: 128000,
    enabled: true,
  },
  {
    id: 'gpt-4o',
    provider: 'openai',
    state: 'CONFIGURED',
    costClass: 'premium',
    maxContextTokens: 128000,
    enabled: true,
  },
];

function allModels(): ModelEntry[] {
  const models = [...DOCKER_MODELS];
  if (process.env.OPENAI_API_KEY) {
    models.push(...OPENAI_MODELS);
  }
  return models;
}

export function resolveModel(modelId: string): {
  ok: true;
  model: ModelEntry;
} | {
  ok: false;
  code: typeof ErrorCodes.MODEL_NOT_ALLOWED | typeof ErrorCodes.PROVIDER_NOT_CONFIGURED;
  message: string;
} {
  const model = allModels().find((m) => m.id === modelId);
  if (!model || !model.enabled) {
    return {
      ok: false,
      code: ErrorCodes.MODEL_NOT_ALLOWED,
      message: `Model "${modelId}" is not on the server allowlist.`,
    };
  }

  if (model.provider === 'openai') {
    if (!process.env.OPENAI_API_KEY) {
      return {
        ok: false,
        code: ErrorCodes.PROVIDER_NOT_CONFIGURED,
        message: 'OpenAI is not configured on this api-server instance.',
      };
    }
    return { ok: true, model };
  }

  if (model.provider === 'galaxia-docker') {
    const dockerAvailable = process.env.DOCKER_INFERENCE_ENABLED !== 'false';
    if (!dockerAvailable) {
      return {
        ok: false,
        code: ErrorCodes.PROVIDER_NOT_CONFIGURED,
        message: 'Docker inference is not enabled on this api-server instance.',
      };
    }
    return { ok: true, model };
  }

  return {
    ok: false,
    code: ErrorCodes.MODEL_NOT_ALLOWED,
    message: `Unknown provider for model "${modelId}".`,
  };
}

export function getProviderStatus() {
  const openAi = Boolean(process.env.OPENAI_API_KEY);
  const anthropic = Boolean(process.env.ANTHROPIC_API_KEY);
  const docker = process.env.DOCKER_INFERENCE_ENABLED !== 'false';

  return {
    mode: 'testnet-preview',
    billing: 'NO_BILLING' as const,
    metering: 'METERING_ONLY' as const,
    providers: [
      {
        id: 'openai',
        state: (openAi ? 'CONFIGURED' : 'NOT_CONFIGURED') as ProviderState,
        models: openAi ? OPENAI_MODELS.map((m) => m.id) : [],
      },
      {
        id: 'anthropic',
        state: (anthropic ? 'CONFIGURED' : 'NOT_CONFIGURED') as ProviderState,
      },
      {
        id: 'galaxia-docker',
        state: (docker ? 'CONFIGURED' : 'DISABLED') as ProviderState,
        models: docker ? DOCKER_MODELS.map((m) => m.id) : [],
      },
    ],
  };
}

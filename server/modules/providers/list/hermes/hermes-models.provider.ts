import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderChangeActiveModelInput,
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
  ProviderSessionActiveModelChange,
} from '@/shared/types.js';
import { writeProviderSessionActiveModelChange } from '@/shared/utils.js';

/**
 * Hermes can route a chat to any provider+model the gateway is patched to honor
 * (see api_server `_create_agent` model/provider override). CloudCLI builds the
 * selectable list from Hermes's on-host model caches and encodes each option as
 * `provider:model`; the runner splits that and sends both fields so the gateway
 * resolves the right provider's credentials. CloudCLI and Hermes run on the
 * same host, so the caches are read directly.
 */
export const HERMES_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [{ value: 'hermes-agent', label: 'hermes-agent (gateway default)' }],
  DEFAULT: 'hermes-agent',
};

function hermesHome(): string {
  return process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
}

async function readJson(file: string): Promise<any | null> {
  try {
    return JSON.parse(await readFile(path.join(hermesHome(), file), 'utf8'));
  } catch {
    return null;
  }
}

export class HermesProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    const options: ProviderModelOption[] = [];
    const seen = new Set<string>();

    const add = (provider: string, model: unknown) => {
      if (typeof model !== 'string' || !model) {
        return;
      }
      const value = `${provider}:${model}`;
      if (seen.has(value)) {
        return;
      }
      seen.add(value);
      options.push({ value, label: `${model} · ${provider}` });
    };

    // provider_models_cache.json: { <provider>: { models: [...] }, ... }
    const cache = await readJson('provider_models_cache.json');
    if (cache && typeof cache === 'object') {
      for (const [provider, info] of Object.entries(cache)) {
        const models = Array.isArray((info as any)?.models) ? (info as any).models : [];
        for (const m of models) {
          add(provider, m);
        }
      }
    }

    // Ollama Cloud keeps a separate cache; merge it in if not already present.
    const ollama = await readJson('ollama_cloud_models_cache.json');
    if (ollama && Array.isArray(ollama.models)) {
      for (const m of ollama.models) {
        add('ollama-cloud', m);
      }
    }

    if (!options.length) {
      return HERMES_FALLBACK_MODELS;
    }

    options.sort((a, b) => a.label.localeCompare(b.label));
    const def = seen.has('ollama-cloud:glm-5.2') ? 'ollama-cloud:glm-5.2' : options[0].value;
    return { OPTIONS: options, DEFAULT: def };
  }

  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    const models = await this.getSupportedModels();
    return { model: models.DEFAULT };
  }

  /**
   * Persist a per-session model override to the shared active-model store, the
   * same as the other providers. An in-dialogue model change goes through the
   * active-model endpoint (not chat.send), so the runner (queryHermes) reads it
   * back via resolveResumeModel on the next message. (Hermes app session ids
   * equal the gateway session id, so the store key matches the runner's id.)
   */
  async changeActiveModel(input: ProviderChangeActiveModelInput): Promise<ProviderSessionActiveModelChange> {
    return writeProviderSessionActiveModelChange('hermes', input);
  }
}

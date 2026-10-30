import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const EMBEDDING_PROVIDER = 'EMBEDDING_PROVIDER';

/**
 * Testable, mockable boundary around whatever embedding backend is
 * configured for this environment. embed() must NEVER throw — a missing
 * API key, a request failure, or a malformed response all resolve to
 * `null` for the affected text(s), so every caller can fall back to
 * keyword-only ranking rather than breaking retrieval. This is the one
 * seam a test replaces to simulate "no provider configured" or "provider
 * failed" without any network access.
 */
export interface EmbeddingProvider {
  readonly modelName: string;
  readonly isConfigured: boolean;
  embed(texts: string[]): Promise<(number[] | null)[]>;
}

/**
 * Reuses the exact same OPENAI_API_KEY config AiService already uses for
 * chat completions (src/ai/ai.service.ts) — no new credential and no new
 * paid service beyond what the org has already configured for the
 * assistant. If OPENAI_API_KEY is unset (the default in .env/.env.example),
 * isConfigured is false and every caller in this codebase treats that as
 * "semantic retrieval unavailable, keyword search only" — never a crash,
 * never a silently-enabled paid call.
 *
 * `dimensions` is passed on the request to bound stored-vector size: OpenAI's
 * text-embedding-3-* models support truncating their native dimensionality
 * via this parameter without a meaningfully different quality trade-off at
 * this scale. 512 keeps each chunk's embedding at ~2KB (512 * 4 bytes) rather
 * than the model's native 1536.
 */
@Injectable()
export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  private readonly logger = new Logger(OpenAiEmbeddingProvider.name);

  static readonly MODEL = 'text-embedding-3-small';
  static readonly DIMENSIONS = 512;

  constructor(private readonly config: ConfigService) {}

  get modelName(): string {
    return OpenAiEmbeddingProvider.MODEL;
  }

  get isConfigured(): boolean {
    return Boolean(this.config.get<string>('OPENAI_API_KEY'));
  }

  async embed(texts: string[]): Promise<(number[] | null)[]> {
    if (!texts.length) return [];
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) return texts.map(() => null);

    try {
      const res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: OpenAiEmbeddingProvider.MODEL,
          input: texts,
          dimensions: OpenAiEmbeddingProvider.DIMENSIONS,
        }),
      });
      if (!res.ok) {
        this.logger.warn(`Embedding request failed with status ${res.status}.`);
        return texts.map(() => null);
      }
      const json = (await res.json()) as { data?: { embedding?: unknown; index?: number }[] };
      const byIndex = new Map<number, number[]>();
      for (const item of json.data ?? []) {
        if (Array.isArray(item.embedding) && typeof item.index === 'number') {
          byIndex.set(item.index, item.embedding as number[]);
        }
      }
      return texts.map((_, i) => byIndex.get(i) ?? null);
    } catch (err) {
      this.logger.warn(`Embedding request threw: ${(err as Error).message}`);
      return texts.map(() => null);
    }
  }
}

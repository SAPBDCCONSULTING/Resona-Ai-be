import { Module } from '@nestjs/common';
import { EMBEDDING_PROVIDER, OpenAiEmbeddingProvider } from './embedding-provider';

/**
 * Standalone and dependency-free (besides the globally-registered
 * ConfigService) so both AiModule (query-time retrieval) and
 * KnowledgeModule (index-time embedding generation) can import it without
 * creating a cycle between them.
 */
@Module({
  providers: [{ provide: EMBEDDING_PROVIDER, useClass: OpenAiEmbeddingProvider }],
  exports: [EMBEDDING_PROVIDER],
})
export class EmbeddingModule {}

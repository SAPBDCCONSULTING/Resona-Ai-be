import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrgModule } from '../org/org.module';
import { EmbeddingModule } from './embedding/embedding.module';
import {
  KnowledgeChunk,
  KnowledgeChunkSchema,
} from '../schemas/knowledge-chunk.schema';
import {
  KnowledgeCollectionEntity,
  KnowledgeCollectionSchema,
} from '../schemas/knowledge-collection.schema';
import {
  KnowledgeSource,
  KnowledgeSourceSchema,
} from '../schemas/knowledge-source.schema';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { KnowledgeBaseService } from './knowledge/knowledge-base.service';

@Module({
  imports: [
    OrgModule,
    EmbeddingModule,
    MongooseModule.forFeature([
      { name: KnowledgeSource.name, schema: KnowledgeSourceSchema },
      { name: KnowledgeChunk.name, schema: KnowledgeChunkSchema },
      { name: KnowledgeCollectionEntity.name, schema: KnowledgeCollectionSchema },
    ]),
  ],
  controllers: [AiController],
  providers: [AiService, KnowledgeBaseService],
  exports: [AiService, KnowledgeBaseService],
})
export class AiModule {}

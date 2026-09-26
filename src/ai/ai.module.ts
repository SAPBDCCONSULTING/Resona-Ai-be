import { Module } from '@nestjs/common';
import { OrgModule } from '../org/org.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { KnowledgeBaseService } from './knowledge/knowledge-base.service';

@Module({
  imports: [OrgModule],
  controllers: [AiController],
  providers: [AiService, KnowledgeBaseService],
  exports: [AiService, KnowledgeBaseService],
})
export class AiModule {}

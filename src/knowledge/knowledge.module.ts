import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { EmbeddingModule } from '../ai/embedding/embedding.module';
import {
  KnowledgeAuditEvent,
  KnowledgeAuditEventSchema,
} from '../schemas/knowledge-audit-event.schema';
import {
  KnowledgeChunk,
  KnowledgeChunkSchema,
} from '../schemas/knowledge-chunk.schema';
import {
  KnowledgeCollectionEntity,
  KnowledgeCollectionSchema,
} from '../schemas/knowledge-collection.schema';
import {
  KnowledgeFeedback,
  KnowledgeFeedbackSchema,
} from '../schemas/knowledge-feedback.schema';
import {
  KnowledgeSource,
  KnowledgeSourceSchema,
} from '../schemas/knowledge-source.schema';
import {
  KnowledgeWebApproval,
  KnowledgeWebApprovalSchema,
} from '../schemas/knowledge-web-approval.schema';
import { Role, RoleSchema } from '../schemas/role.schema';
import { User, UserSchema } from '../schemas/user.schema';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeCollectionController } from './knowledge-collection.controller';
import { KnowledgeCollectionService } from './knowledge-collection.service';
import { KnowledgeFeedbackController } from './knowledge-feedback.controller';
import { KnowledgeFeedbackService } from './knowledge-feedback.service';
import { KnowledgeWebApprovalController } from './knowledge-web-approval.controller';
import { KnowledgeWebApprovalService } from './knowledge-web-approval.service';
import { MALWARE_SCAN_PROVIDER, NoopMalwareScanProvider } from './malware-scan-provider';

@Module({
  imports: [
    AuthModule,
    EmbeddingModule,
    MongooseModule.forFeature([
      { name: KnowledgeSource.name, schema: KnowledgeSourceSchema },
      { name: KnowledgeChunk.name, schema: KnowledgeChunkSchema },
      { name: KnowledgeAuditEvent.name, schema: KnowledgeAuditEventSchema },
      { name: KnowledgeWebApproval.name, schema: KnowledgeWebApprovalSchema },
      { name: KnowledgeCollectionEntity.name, schema: KnowledgeCollectionSchema },
      { name: KnowledgeFeedback.name, schema: KnowledgeFeedbackSchema },
      { name: User.name, schema: UserSchema },
      { name: Role.name, schema: RoleSchema },
    ]),
  ],
  controllers: [
    KnowledgeController,
    KnowledgeWebApprovalController,
    KnowledgeCollectionController,
    KnowledgeFeedbackController,
  ],
  providers: [
    KnowledgeService,
    KnowledgeWebApprovalService,
    KnowledgeCollectionService,
    KnowledgeFeedbackService,
    { provide: MALWARE_SCAN_PROVIDER, useClass: NoopMalwareScanProvider },
  ],
  exports: [
    KnowledgeService,
    KnowledgeWebApprovalService,
    KnowledgeCollectionService,
    KnowledgeFeedbackService,
  ],
})
export class KnowledgeModule {}

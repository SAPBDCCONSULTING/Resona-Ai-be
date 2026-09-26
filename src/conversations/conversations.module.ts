import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { Conversation, ConversationSchema } from '../schemas/conversation.schema';
import { ResponsesModule } from '../responses/responses.module';
import { SessionsModule } from '../sessions/sessions.module';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

@Module({
  imports: [
    AuthModule,
    SessionsModule,
    ResponsesModule,
    AiModule,
    MongooseModule.forFeature([
      { name: Conversation.name, schema: ConversationSchema },
    ]),
  ],
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}

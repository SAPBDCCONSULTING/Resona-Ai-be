import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { Session, SessionSchema } from '../schemas/session.schema';
import {
  PublicSessionsController,
  SessionsController,
} from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([{ name: Session.name, schema: SessionSchema }]),
  ],
  controllers: [SessionsController, PublicSessionsController],
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}

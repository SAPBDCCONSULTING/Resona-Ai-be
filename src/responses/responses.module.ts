import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { Response, ResponseSchema } from '../schemas/response.schema';
import { Session, SessionSchema } from '../schemas/session.schema';
import { ResponsesController } from './responses.controller';
import { ResponsesService } from './responses.service';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: Response.name, schema: ResponseSchema },
      { name: Session.name, schema: SessionSchema },
    ]),
  ],
  controllers: [ResponsesController],
  providers: [ResponsesService],
  exports: [ResponsesService],
})
export class ResponsesModule {}

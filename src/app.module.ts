import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { HealthModule } from './health/health.module';
import { RedisModule } from './redis/redis.module';
import { RateLimitMiddleware } from './redis/rate-limit.middleware';
import { AuthModule } from './auth/auth.module';
import { SessionsModule } from './sessions/sessions.module';
import { SeedModule } from './seed/seed.module';
import { AiModule } from './ai/ai.module';
import { ContactsModule } from './contacts/contacts.module';
import { TemplatesModule } from './templates/templates.module';
import { ResponsesModule } from './responses/responses.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { RolesModule } from './roles/roles.module';
import { OrgModule } from './org/org.module';
import { UsersModule } from './users/users.module';
import { ConversationsModule } from './conversations/conversations.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGODB_URI', 'mongodb://127.0.0.1:27017/resona'),
      }),
    }),
    RedisModule,
    HealthModule,
    AuthModule,
    SessionsModule,
    CampaignsModule,
    AiModule,
    ContactsModule,
    TemplatesModule,
    ResponsesModule,
    ConversationsModule,
    RolesModule,
    OrgModule,
    UsersModule,
    SeedModule,
  ],
  providers: [RateLimitMiddleware],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RateLimitMiddleware).forRoutes('{*path}');
  }
}

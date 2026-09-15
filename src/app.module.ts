import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { HealthModule } from './health/health.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { SessionsModule } from './sessions/sessions.module';
import { SeedModule } from './seed/seed.module';
import { AiModule } from './ai/ai.module';
import { ContactsModule } from './contacts/contacts.module';
import { TemplatesModule } from './templates/templates.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGODB_URI', 'mongodb://127.0.0.1:27017/pulsefeedback'),
      }),
    }),
    RedisModule,
    HealthModule,
    AuthModule,
    SessionsModule,
    AiModule,
    ContactsModule,
    TemplatesModule,
    SeedModule,
  ],
})
export class AppModule {}

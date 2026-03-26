import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { loadEnv } from '@qa/config';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { RequestIdInterceptor } from './common/interceptors/request-id.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
  const env = loadEnv();

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  // Security
  app.use(helmet());
  app.enableCors({
    origin: env.NODE_ENV === 'production' ? env.API_URL : true,
    credentials: true,
  });

  // Global prefix
  app.setGlobalPrefix('api/v1');

  // Global pipes — validate + transform all DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Global filters
  app.useGlobalFilters(new HttpExceptionFilter());

  // Global interceptors
  app.useGlobalInterceptors(new RequestIdInterceptor(), new LoggingInterceptor());

  // Swagger (non-production only)
  if (env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('QA Platform API')
      .setDescription('Multi-tenant SaaS QA evaluation platform')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.listen(env.PORT);
  console.log(`API running on port ${env.PORT} [${env.NODE_ENV}]`);
}

bootstrap();

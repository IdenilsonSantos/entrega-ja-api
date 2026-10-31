import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { config, runsHttp } from './config';
import { UPLOAD_ROUTE } from './infra/storage/storage.service';

async function bootstrap() {
  const log = new Logger('Bootstrap');

  // Worker puro: sem HTTP, só as filas
  if (!runsHttp) {
    const app = await NestFactory.createApplicationContext(AppModule);
    app.enableShutdownHooks();
    log.log('Worker rodando (despacho e push)');
    return;
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({ origin: config.corsOrigins, exposedHeaders: ['Content-Type'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useStaticAssets(config.uploadDir, { prefix: UPLOAD_ROUTE, maxAge: '30d', immutable: true });
  app.set('trust proxy', 1);
  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');
  log.log(`API em http://localhost:${config.port}/api (papel: ${config.role})`);
}
bootstrap();

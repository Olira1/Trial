import { Logger, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { env } from './config';

const apiVersions = ['1'] as const;

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const e = env();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableShutdownHooks();
  app.set('trust proxy', e.NODE_ENV === 'development' ? true : e.TRUST_PROXY);
  app.useBodyParser('json', { limit: e.JSON_BODY_LIMIT });
  app.useBodyParser('urlencoded', {
    limit: e.JSON_BODY_LIMIT,
    extended: true,
  });
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    prefix: 'v',
    defaultVersion: '1',
  });

  // CSP relaxed on docs paths so Swagger UI and Better Auth's Scalar UI can run.
  const strictHelmet = helmet();
  const docsHelmet = helmet({ contentSecurityPolicy: false });
  const docsPathPrefixes = apiVersions.map((v) => `/api/v${v}/docs`);
  const isDocsRequest = (req: Request) =>
    docsPathPrefixes.some(
      (p) => req.path === p || req.path.startsWith(`${p}/`),
    );
  app.use((req: Request, res: Response, next: NextFunction) =>
    isDocsRequest(req)
      ? docsHelmet(req, res, next)
      : strictHelmet(req, res, next),
  );

  const corsOrigin =
    e.NODE_ENV === 'development'
      ? true
      : e.ALLOWED_ORIGINS.includes('localhost')
        ? /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
        : e.ALLOWED_ORIGINS;

  app.enableCors({
    origin: corsOrigin,
    credentials: true,
  });
  app.useGlobalFilters(new AllExceptionsFilter());

  const expressApp = app.getHttpAdapter().getInstance();

  for (const version of apiVersions) {
    const versionPrefix = `/api/v${version}`;
    const config = new DocumentBuilder()
      .setTitle(`Ubel API v${version}`)
      .setDescription('Ubel Transport backend API')
      .setVersion(version)
      .addBearerAuth({ type: 'http', scheme: 'bearer' }, 'session')
      .build();

    const fullDoc = cleanupOpenApiDoc(
      SwaggerModule.createDocument(app, config),
    );
    // Filter to this version AND strip the version prefix from path keys so
    // server.url + path doesn't produce /api/v1/api/v1/...
    fullDoc.paths = Object.fromEntries(
      Object.entries(fullDoc.paths)
        .filter(([path]) => path.startsWith(`${versionPrefix}/`))
        .map(([path, item]) => [path.slice(versionPrefix.length), item]),
    );

    // Serve the OpenAPI JSON with a server URL derived from the actual request
    // host so Postman/Swagger UI always gets the right base URL regardless of env.
    expressApp.get(
      `/api/v${version}/api-json`,
      (req: Request, res: Response) => {
        res.json({
          ...fullDoc,
          servers: [
            {
              url: `${e.NODE_ENV === 'production' ? 'https' : req.protocol}://${req.get('host')}/api/v${version}`,
            },
          ],
        });
      },
    );

    SwaggerModule.setup(`api/v${version}/docs`, app, fullDoc, {
      swaggerOptions: {
        urls: [{ url: `/api/v${version}/api-json`, name: 'App API' }],
        urls_primary_name: 'App API',
      },
    });
  }

  await app.listen(e.PORT);
  logger.log(`Ubel API listening on http://localhost:${e.PORT}`);
  for (const version of apiVersions) {
    logger.log(
      `v${version} docs: http://localhost:${e.PORT}/api/v${version}/docs`,
    );
  }
}
void bootstrap();

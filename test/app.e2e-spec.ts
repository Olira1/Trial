import { INestApplication, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('App (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({
      type: VersioningType.URI,
      prefix: 'v',
      defaultVersion: '1',
    });
    app.enableShutdownHooks();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects unauthenticated /api/v1/auth/me with 401', () => {
    return request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
  });

  it('rejects unauthenticated profile edits with 401', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/auth/me')
      .send({ firstName: 'Unauthenticated' })
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/auth/me/image/upload-url')
      .send({
        mimeType: 'image/jpeg',
        originalName: 'avatar.jpg',
        sizeBytes: 1024,
      })
      .expect(401);
  });

  it('rejects unauthenticated admin dispatch inspection with 401', () => {
    return request(app.getHttpServer())
      .get('/api/v1/admin/dispatch/queues')
      .expect(401);
  });

  it('rejects unauthenticated fare estimates with 401', () => {
    return request(app.getHttpServer())
      .post('/api/v1/fare-estimates')
      .send({
        pickup: { latitude: 9.0192, longitude: 38.7525 },
        destination: { latitude: 9.0301, longitude: 38.7612 },
      })
      .expect(401);
  });

  it('returns 404 for unversioned root', () => {
    return request(app.getHttpServer()).get('/').expect(404);
  });

  it('reports database and Redis readiness from /api/v1/health', async () => {
    let response:
      | Awaited<ReturnType<ReturnType<typeof request>['get']>>
      | undefined;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      response = await request(app.getHttpServer()).get('/api/v1/health');
      if (response.status === 200) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    expect(response?.status).toBe(200);

    expect(response?.body).toMatchObject({
      status: 'ok',
      info: {
        database: { status: 'up' },
        redis: { status: 'up' },
      },
      details: {
        database: { status: 'up' },
        redis: { status: 'up' },
      },
    });
  });
});

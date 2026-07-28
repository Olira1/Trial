import { INestApplication, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { DRIZZLE, type Database } from './../src/database/database.module';
import { authIdentity } from './../src/modules/auth/schema/auth-identity.schema';
import {
  ROUTING_PROVIDER,
  type RoutingProvider,
} from './../src/modules/dispatch-routing';
import { fareEstimate } from './../src/modules/fare-estimates/schema';
import { rideRequest } from './../src/modules/ride-requests/schema';
import { user } from './../src/modules/user';

const PHONE = '+251911000166';
const DEVICE_ID = 'fare-estimates-e2e-device';

type FareEstimateResponseBody = {
  id: string;
  pickup: { latitude: number; longitude: number };
  destination: { latitude: number; longitude: number };
  vehicleType: 'standard';
  currency: 'ETB';
  distanceMeters: number;
  durationSeconds: number;
  rateMinorPerKm: number;
  estimatedFareMinor: number;
  expiresAt: string;
  createdAt: string;
};

type RideRequestResponseBody = {
  id: string;
  pickup: { latitude: number; longitude: number };
  destination: { latitude: number; longitude: number };
  fareEstimateId: string;
  vehicleType: 'standard';
  rideType: 'instant';
  currency: 'ETB';
  distanceMeters: number;
  durationSeconds: number;
  rateMinorPerKm: number;
  estimatedFareMinor: number;
  idempotencyKey: string;
};

describe('Fare estimates (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let accessToken: string;
  let userId: string;
  let routingProvider: jest.Mocked<RoutingProvider>;

  const deleteUserForPhone = async () => {
    await db.transaction(async (tx) => {
      const [identity] = await tx
        .select({ userId: authIdentity.userId })
        .from(authIdentity)
        .where(eq(authIdentity.identifier, PHONE))
        .limit(1);

      if (!identity) return;

      await tx.delete(user).where(eq(user.id, identity.userId));
    });
  };

  beforeAll(async () => {
    routingProvider = {
      estimateBatch: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ROUTING_PROVIDER)
      .useValue(routingProvider)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({
      type: VersioningType.URI,
      prefix: 'v',
      defaultVersion: '1',
    });
    app.enableShutdownHooks();
    await app.init();

    db = app.get<Database>(DRIZZLE);
    await deleteUserForPhone();

    const signupStart = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-up/start')
      .send({
        phoneNumber: PHONE,
        firstName: 'Fare',
        lastName: 'Estimator',
        gender: 'female',
        deviceId: DEVICE_ID,
        role: 'rider',
      })
      .expect(200);

    const signupStartBody = signupStart.body as {
      signUpChallengeId: string;
    };

    const signupVerify = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-up/verify')
      .send({
        challengeId: signupStartBody.signUpChallengeId,
        code: '000000',
        deviceId: DEVICE_ID,
      })
      .expect(200);

    accessToken = (signupVerify.body as { accessToken: string }).accessToken;

    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    userId = (me.body as { id: string }).id;
  });

  afterAll(async () => {
    if (db) {
      await deleteUserForPhone();
    }
    await app.close();
  });

  it('creates an authenticated standard fare estimate', async () => {
    const pickup = { latitude: 9.0192, longitude: 38.7525 };
    const destination = { latitude: 9.0301, longitude: 38.7612 };
    routingProvider.estimateBatch.mockResolvedValueOnce([
      {
        status: 'routed',
        distanceMeters: 1_250,
        durationSeconds: 180,
      },
    ]);

    const response = await request(app.getHttpServer())
      .post('/api/v1/fare-estimates')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ pickup, destination })
      .expect(201);
    const body = response.body as FareEstimateResponseBody;

    expect(routingProvider.estimateBatch.mock.calls[0]).toEqual([
      [{ origin: pickup, destination }],
    ]);
    expect(body).toMatchObject({
      pickup,
      destination,
      vehicleType: 'standard',
      currency: 'ETB',
      distanceMeters: 1_250,
      durationSeconds: 180,
      rateMinorPerKm: 900,
      estimatedFareMinor: 1_100,
    });
    expect(body).not.toHaveProperty('riderId');
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(
      Date.parse(body.createdAt),
    );

    const [created] = await db
      .select({
        riderId: fareEstimate.riderId,
        estimatedFareMinor: fareEstimate.estimatedFareMinor,
      })
      .from(fareEstimate)
      .where(eq(fareEstimate.id, body.id))
      .limit(1);

    expect(created).toEqual({
      riderId: userId,
      estimatedFareMinor: 1_100,
    });
  });

  it('creates a ride request from an authenticated fare estimate', async () => {
    const pickup = { latitude: 9.0192, longitude: 38.7525 };
    const destination = { latitude: 9.0301, longitude: 38.7612 };
    routingProvider.estimateBatch.mockResolvedValueOnce([
      {
        status: 'routed',
        distanceMeters: 1_250,
        durationSeconds: 180,
      },
    ]);

    const estimateResponse = await request(app.getHttpServer())
      .post('/api/v1/fare-estimates')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ pickup, destination })
      .expect(201);
    const estimate = estimateResponse.body as FareEstimateResponseBody;

    const response = await request(app.getHttpServer())
      .post('/api/v1/ride-requests')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        pickup,
        destination,
        fareEstimateId: estimate.id,
        idempotencyKey: 'fare-bound-request',
      })
      .expect(201);
    const body = response.body as RideRequestResponseBody;

    expect(body).toMatchObject({
      pickup,
      destination,
      fareEstimateId: estimate.id,
      vehicleType: 'standard',
      rideType: 'instant',
      currency: 'ETB',
      distanceMeters: 1_250,
      durationSeconds: 180,
      rateMinorPerKm: 900,
      estimatedFareMinor: 1_100,
      idempotencyKey: 'fare-bound-request',
    });

    const [created] = await db
      .select({
        riderId: rideRequest.riderId,
        fareEstimateId: rideRequest.fareEstimateId,
        estimatedFareMinor: rideRequest.estimatedFareMinor,
      })
      .from(rideRequest)
      .where(eq(rideRequest.id, body.id))
      .limit(1);

    expect(created).toEqual({
      riderId: userId,
      fareEstimateId: estimate.id,
      estimatedFareMinor: 1_100,
    });
  });
});

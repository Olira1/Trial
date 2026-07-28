import { INestApplication, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { DRIZZLE, type Database } from './../src/database/database.module';
import { authIdentity } from './../src/modules/auth/schema/auth-identity.schema';
import { authSession } from './../src/modules/auth/schema/session.schema';
import {
  supportBugReport,
  supportBugReportScreenshot,
  supportContact,
  supportFeedback,
} from './../src/modules/support/schema';
import { user } from './../src/modules/user';

const PHONE = '+251911000065';
const DEVICE_ID = 'support-e2e-device';
type ProfileBody = {
  id: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  phone: string | null;
  phoneNumber: string | null;
  image: string | null;
  avatar: string | null;
  profilePicture: string | null;
};

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe('Support and profile endpoints (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let accessToken: string;
  let userId: string;

  const deleteSupportRows = async (id: string) => {
    const reports = await db
      .select({ id: supportBugReport.id })
      .from(supportBugReport)
      .where(eq(supportBugReport.userId, id));

    for (const report of reports) {
      await db
        .delete(supportBugReportScreenshot)
        .where(eq(supportBugReportScreenshot.bugReportId, report.id));
    }

    await db.delete(supportBugReport).where(eq(supportBugReport.userId, id));
    await db.delete(supportFeedback).where(eq(supportFeedback.userId, id));
    await db.delete(supportContact).where(eq(supportContact.userId, id));
  };

  const deleteUserForPhone = async () => {
    const [identity] = await db
      .select({ userId: authIdentity.userId })
      .from(authIdentity)
      .where(eq(authIdentity.identifier, PHONE))
      .limit(1);

    if (!identity) return;
    await deleteSupportRows(identity.userId);
    await db.delete(authSession).where(eq(authSession.userId, identity.userId));
    await db.delete(user).where(eq(user.id, identity.userId));
  };

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

    db = app.get<Database>(DRIZZLE);
    await deleteUserForPhone();

    const signupStart = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-up/start')
      .send({
        phoneNumber: PHONE,
        firstName: 'Endpoint',
        middleName: 'Support',
        lastName: 'Tester',
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

  afterEach(async () => {
    await sleep(1100);
  });

  afterAll(async () => {
    if (db && userId) {
      await deleteSupportRows(userId);
      await db.delete(authSession).where(eq(authSession.userId, userId));
      await db.delete(user).where(eq(user.id, userId));
    }
    await app.close();
  });

  const authGet = (path: string) =>
    request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${accessToken}`);

  const authPost = (path: string) =>
    request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${accessToken}`);

  const authPatch = (path: string) =>
    request(app.getHttpServer())
      .patch(path)
      .set('Authorization', `Bearer ${accessToken}`);

  const authDelete = (path: string) =>
    request(app.getHttpServer())
      .delete(path)
      .set('Authorization', `Bearer ${accessToken}`);

  it('returns the enriched current-user profile fields from /auth/me', async () => {
    const response = await authGet('/api/v1/auth/me').expect(200);

    expect(response.body).toMatchObject({
      id: userId,
      firstName: 'Endpoint',
      middleName: 'Support',
      lastName: 'Tester',
      phone: PHONE,
      phoneNumber: PHONE,
      email: null,
      miles: 0,
      rating: 5,
      trips: 0,
      isIdVerified: false,
      isFaydaVerified: false,
      isLicenseVerified: false,
      isDocumentVerified: false,
      avatar: null,
      profilePicture: null,
    });
  });

  it('updates editable profile fields and profile image', async () => {
    const upload = await authPost('/api/v1/auth/me/image/upload-url')
      .send({
        mimeType: 'image/jpeg',
        originalName: 'avatar.jpg',
        sizeBytes: 1024,
      })
      .expect(200);

    const uploadBody = upload.body as { url: string; key: string };
    expect(uploadBody.url).toMatch(/^https?:\/\//);
    expect(uploadBody.key).toContain(`profile-images/${userId}`);

    const updated = await authPatch('/api/v1/auth/me')
      .send({
        firstName: 'Endpoint Updated',
        middleName: null,
        lastName: 'Profile',
        imageKey: uploadBody.key,
      })
      .expect(200);
    const updatedBody = updated.body as ProfileBody;

    expect(updatedBody).toMatchObject({
      id: userId,
      firstName: 'Endpoint Updated',
      middleName: null,
      lastName: 'Profile',
      phone: PHONE,
      phoneNumber: PHONE,
    });
    expect(updatedBody.image).toMatch(/^https?:\/\//);
    expect(updatedBody.avatar).toBe(updatedBody.image);
    expect(updatedBody.profilePicture).toBe(updatedBody.image);

    const cleared = await authPatch('/api/v1/auth/me')
      .send({ imageKey: null })
      .expect(200);
    const clearedBody = cleared.body as ProfileBody;

    expect(clearedBody).toMatchObject({
      image: null,
      avatar: null,
      profilePicture: null,
    });
  });

  it('creates a bug report through upload-url and report endpoints', async () => {
    const upload = await authPost(
      '/api/v1/support/bug-reports/screenshots/upload-url',
    )
      .send({
        mimeType: 'image/jpeg',
        originalName: 'crash.jpg',
        sizeBytes: 1024,
      })
      .expect(200);

    const uploadBody = upload.body as { url: string; key: string };
    expect(uploadBody.url).toMatch(/^https?:\/\//);
    expect(uploadBody.key).toContain(`bug-reports/${userId}`);

    const report = await authPost('/api/v1/support/bug-reports')
      .send({
        severity: 'critical',
        impact: 'cant_use_app',
        area: 'crash',
        details: 'The app crashes when confirming a booking.',
        stepsToReproduce: 'Open the app, create a booking, confirm it.',
        screenshotKeys: [uploadBody.key],
      })
      .expect(201);

    const reportBody = report.body as {
      screenshots: Array<{ storageKey: string; url: string }>;
    };
    expect(report.body).toMatchObject({
      userId,
      severity: 'critical',
      impact: 'cant_use_app',
      area: 'crash',
      details: 'The app crashes when confirming a booking.',
      stepsToReproduce: 'Open the app, create a booking, confirm it.',
    });
    expect(reportBody.screenshots).toHaveLength(1);
    expect(reportBody.screenshots[0]?.storageKey).toBe(uploadBody.key);
    expect(reportBody.screenshots[0]?.url).toMatch(/^https?:\/\//);
  });

  it('creates a bug report without reproduction steps', async () => {
    const report = await authPost('/api/v1/support/bug-reports')
      .send({
        severity: 'medium',
        impact: 'feature_broken',
        area: 'booking',
        details: 'Booking confirmation does not finish.',
      })
      .expect(201);

    expect(report.body).toMatchObject({
      userId,
      severity: 'medium',
      impact: 'feature_broken',
      area: 'booking',
      details: 'Booking confirmation does not finish.',
      stepsToReproduce: null,
      screenshots: [],
    });
  });

  it('creates feedback through the feedback endpoint', async () => {
    const response = await authPost('/api/v1/support/feedback')
      .send({
        rating: 5,
        topic: 'app_experience',
        wouldRecommend: true,
        title: 'Smooth experience',
        feedback: 'The app is easy to use.',
      })
      .expect(201);

    expect(response.body).toMatchObject({
      userId,
      rating: 5,
      topic: 'app_experience',
      wouldRecommend: true,
      title: 'Smooth experience',
      feedback: 'The app is easy to use.',
    });
  });

  it('exercises emergency contact list, create, update, and delete endpoints', async () => {
    await authGet('/api/v1/support/emergency-contacts').expect(200).expect([]);

    const created = await authPost('/api/v1/support/emergency-contacts')
      .send({ name: 'Emergency Contact', phone: '+251911111111' })
      .expect(201);

    expect(created.body).toMatchObject({
      userId,
      type: 'emergency',
      name: 'Emergency Contact',
      phone: '+251911111111',
    });

    const contactId = (created.body as { id: string }).id;
    const updated = await authPatch(
      `/api/v1/support/emergency-contacts/${contactId}`,
    )
      .send({ phone: '+251922222222' })
      .expect(200);

    expect(updated.body).toMatchObject({
      id: contactId,
      type: 'emergency',
      phone: '+251922222222',
    });

    const listed = await authGet('/api/v1/support/emergency-contacts').expect(
      200,
    );
    const listedBody = listed.body as Array<{ id: string }>;
    expect(listedBody).toHaveLength(1);
    expect(listedBody[0]).toMatchObject({ id: contactId });

    await authDelete(`/api/v1/support/emergency-contacts/${contactId}`)
      .expect(200)
      .expect({ message: 'contact deleted' });

    await authGet('/api/v1/support/emergency-contacts').expect(200).expect([]);
  });

  it('exercises trusted contact list, create, update, and delete endpoints', async () => {
    await authGet('/api/v1/support/trusted-contacts').expect(200).expect([]);

    const created = await authPost('/api/v1/support/trusted-contacts')
      .send({ name: 'Trusted Contact', phone: '+251933333333' })
      .expect(201);

    expect(created.body).toMatchObject({
      userId,
      type: 'trusted',
      name: 'Trusted Contact',
      phone: '+251933333333',
    });

    const contactId = (created.body as { id: string }).id;
    const updated = await authPatch(
      `/api/v1/support/trusted-contacts/${contactId}`,
    )
      .send({ name: 'Updated Trusted Contact' })
      .expect(200);

    expect(updated.body).toMatchObject({
      id: contactId,
      type: 'trusted',
      name: 'Updated Trusted Contact',
    });

    const listed = await authGet('/api/v1/support/trusted-contacts').expect(
      200,
    );
    const listedBody = listed.body as Array<{ id: string }>;
    expect(listedBody).toHaveLength(1);
    expect(listedBody[0]).toMatchObject({ id: contactId });

    await authDelete(`/api/v1/support/trusted-contacts/${contactId}`)
      .expect(200)
      .expect({ message: 'contact deleted' });

    await authGet('/api/v1/support/trusted-contacts').expect(200).expect([]);
  });
});

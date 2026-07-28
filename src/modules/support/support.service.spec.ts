import assert from 'node:assert';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { databaseConfig } from '../../config';
import {
  DatabaseModule,
  DRIZZLE,
  PG_POOL,
  type Database,
} from '../../database/database.module';
import { StorageService } from '../storage';
import { user, type User } from '../user';
import {
  supportBugReport,
  supportBugReportScreenshot,
  supportContact,
  supportFeedback,
} from './schema';
import { SupportService } from './support.service';

const storageMock = {
  getUploadUrl: jest.fn((input: { folder: string; originalName: string }) =>
    Promise.resolve({
      url: `https://upload.ubel.test/${input.originalName}`,
      key: `${input.folder}/${input.originalName}`,
    }),
  ),
  getDownloadUrl: jest.fn((key: string) =>
    Promise.resolve(`https://download.ubel.test/${key}`),
  ),
  delete: jest.fn(),
};

describe('SupportService (integration)', () => {
  let moduleRef: TestingModule;
  let service: SupportService;
  let db: Database;
  let testUser: User;
  let otherUser: User;

  const deleteSupportRows = async (userId: string) => {
    const reports = await db
      .select({ id: supportBugReport.id })
      .from(supportBugReport)
      .where(eq(supportBugReport.userId, userId));

    for (const report of reports) {
      await db
        .delete(supportBugReportScreenshot)
        .where(eq(supportBugReportScreenshot.bugReportId, report.id));
    }

    await db
      .delete(supportBugReport)
      .where(eq(supportBugReport.userId, userId));
    await db.delete(supportFeedback).where(eq(supportFeedback.userId, userId));
    await db.delete(supportContact).where(eq(supportContact.userId, userId));
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [databaseConfig],
        }),
        DatabaseModule,
      ],
      providers: [
        SupportService,
        { provide: StorageService, useValue: storageMock },
      ],
    }).compile();

    service = moduleRef.get(SupportService);
    db = moduleRef.get<Database>(DRIZZLE);

    const [createdUser] = await db
      .insert(user)
      .values({
        firstName: 'Support',
        lastName: 'Tester',
        roles: ['rider'],
      })
      .returning();
    assert(createdUser, 'test setup: user insert returned no row');
    testUser = createdUser;

    const [createdOtherUser] = await db
      .insert(user)
      .values({
        firstName: 'Other',
        lastName: 'Support Tester',
        roles: ['rider'],
      })
      .returning();
    assert(createdOtherUser, 'test setup: other user insert returned no row');
    otherUser = createdOtherUser;
  });

  beforeEach(async () => {
    assert(testUser, 'test setup: user missing');
    assert(otherUser, 'test setup: other user missing');
    jest.clearAllMocks();
    await deleteSupportRows(testUser.id);
    await deleteSupportRows(otherUser.id);
  });

  afterAll(async () => {
    if (db && testUser) {
      await deleteSupportRows(testUser.id);
      await db.delete(user).where(eq(user.id, testUser.id));
    }
    if (db && otherUser) {
      await deleteSupportRows(otherUser.id);
      await db.delete(user).where(eq(user.id, otherUser.id));
    }
    if (moduleRef) await moduleRef.get<Pool>(PG_POOL).end();
  });

  it('returns a bug-report screenshot upload url scoped to the user', async () => {
    const result = await service.getBugReportScreenshotUploadUrl(testUser.id, {
      mimeType: 'image/jpeg',
      originalName: 'crash.jpg',
      sizeBytes: 1024,
    });

    expect(result).toEqual({
      url: 'https://upload.ubel.test/crash.jpg',
      key: `bug-reports/${testUser.id}/crash.jpg`,
    });
    expect(storageMock.getUploadUrl).toHaveBeenCalledWith({
      folder: `bug-reports/${testUser.id}`,
      mimeType: 'image/jpeg',
      originalName: 'crash.jpg',
      sizeBytes: 1024,
    });
  });

  it('creates bug reports with and without screenshots', async () => {
    const withoutScreenshots = await service.createBugReport(testUser.id, {
      severity: 'medium',
      impact: 'feature_broken',
      area: 'booking',
      details: 'Booking confirmation does not finish.',
    });

    expect(withoutScreenshots).toMatchObject({
      userId: testUser.id,
      severity: 'medium',
      stepsToReproduce: null,
      screenshots: [],
    });

    const withScreenshots = await service.createBugReport(testUser.id, {
      severity: 'critical',
      impact: 'cant_use_app',
      area: 'crash',
      details: 'The app crashes on launch.',
      stepsToReproduce: 'Open the app.',
      screenshotKeys: [
        `bug-reports/${testUser.id}/a.jpg`,
        `bug-reports/${testUser.id}/b.jpg`,
      ],
    });

    expect(withScreenshots.screenshots).toHaveLength(2);
    expect(withScreenshots.screenshots[0]).toMatchObject({
      storageKey: `bug-reports/${testUser.id}/a.jpg`,
      url: `https://download.ubel.test/bug-reports/${testUser.id}/a.jpg`,
    });
    expect(storageMock.getDownloadUrl).toHaveBeenCalledTimes(2);
  });

  it('creates bug report screenshots with long pre-signed download urls', async () => {
    const longUrl = `https://download.ubel.test/${'a'.repeat(700)}`;
    storageMock.getDownloadUrl.mockResolvedValueOnce(longUrl);

    const report = await service.createBugReport(testUser.id, {
      severity: 'high',
      impact: 'cant_use_app',
      area: 'crash',
      details: 'A crash screenshot URL has a long security token.',
      screenshotKeys: [`bug-reports/${testUser.id}/long-url.jpg`],
    });

    expect(report.screenshots).toHaveLength(1);
    expect(report.screenshots[0]?.url).toBe(longUrl);
  });

  it('rejects bug reports with more than four screenshots', async () => {
    await expect(
      service.createBugReport(testUser.id, {
        severity: 'low',
        impact: 'minor_glitch',
        area: 'ui_layout',
        details: 'Layout is off.',
        screenshotKeys: ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg'],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(storageMock.getDownloadUrl).not.toHaveBeenCalled();
  });

  it('creates feedback with rating, topic, recommendation, and text', async () => {
    const result = await service.createFeedback(testUser.id, {
      rating: 5,
      topic: 'app_experience',
      wouldRecommend: true,
      title: 'Smooth booking',
      feedback: 'The app feels quick.',
    });

    expect(result).toMatchObject({
      userId: testUser.id,
      rating: 5,
      topic: 'app_experience',
      wouldRecommend: true,
      title: 'Smooth booking',
    });
  });

  it('keeps emergency and trusted contacts separate through CRUD', async () => {
    const emergency = await service.createContact(testUser.id, 'emergency', {
      name: 'Emergency One',
      phone: '+251911111111',
    });
    const trusted = await service.createContact(testUser.id, 'trusted', {
      name: 'Trusted One',
      phone: '+251922222222',
    });

    await expect(
      service.listContacts(testUser.id, 'emergency'),
    ).resolves.toMatchObject([{ id: emergency.id }]);
    await expect(
      service.listContacts(testUser.id, 'trusted'),
    ).resolves.toMatchObject([{ id: trusted.id }]);

    const updated = await service.updateContact(
      testUser.id,
      'emergency',
      emergency.id,
      { phone: '+251933333333' },
    );
    expect(updated.phone).toBe('+251933333333');

    await expect(
      service.deleteContact(testUser.id, 'emergency', emergency.id),
    ).resolves.toEqual({ message: 'contact deleted' });
    await expect(
      service.listContacts(testUser.id, 'emergency'),
    ).resolves.toHaveLength(0);
    await expect(
      service.listContacts(testUser.id, 'trusted'),
    ).resolves.toHaveLength(1);
  });

  it('enforces five active contacts per type and ignores soft-deleted rows', async () => {
    for (let index = 0; index < 5; index += 1) {
      await service.createContact(testUser.id, 'trusted', {
        name: `Trusted ${index}`,
        phone: `+25191111111${index}`,
      });
    }

    await expect(
      service.createContact(testUser.id, 'trusted', {
        name: 'Too Many',
        phone: '+251922222222',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    const [first] = await service.listContacts(testUser.id, 'trusted');
    assert(first, 'expected a trusted contact');
    await service.deleteContact(testUser.id, 'trusted', first.id);

    await expect(
      service.createContact(testUser.id, 'trusted', {
        name: 'Replacement',
        phone: '+251933333333',
      }),
    ).resolves.toMatchObject({ name: 'Replacement' });
    await expect(
      service.listContacts(testUser.id, 'trusted'),
    ).resolves.toHaveLength(5);
  });

  it('prevents users from modifying another user contact', async () => {
    const contact = await service.createContact(testUser.id, 'emergency', {
      name: 'Private Contact',
      phone: '+251944444444',
    });

    await expect(
      service.updateContact(otherUser.id, 'emergency', contact.id, {
        name: 'Changed',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.deleteContact(otherUser.id, 'emergency', contact.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.listContacts(otherUser.id, 'emergency'),
    ).resolves.toHaveLength(0);
  });
});

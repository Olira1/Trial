import {
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../database/database.module';
import { StorageService } from '../storage';
import {
  supportBugReport,
  supportBugReportScreenshot,
  supportContact,
  supportFeedback,
  type NewSupportBugReport,
  type NewSupportContact,
  type NewSupportFeedback,
  type SupportContactType,
} from './schema';

const MAX_CONTACTS_PER_TYPE = 5;
const MAX_BUG_REPORT_SCREENSHOTS = 4;

export type CreateBugReportInput = Pick<
  NewSupportBugReport,
  'severity' | 'impact' | 'area' | 'details' | 'stepsToReproduce'
> & {
  screenshotKeys?: string[];
};

export type CreateFeedbackInput = Pick<
  NewSupportFeedback,
  'rating' | 'topic' | 'wouldRecommend' | 'title' | 'feedback'
>;

export type CreateSupportContactInput = Pick<
  NewSupportContact,
  'name' | 'phone'
>;

export type UpdateSupportContactInput = Partial<CreateSupportContactInput>;

@Injectable()
export class SupportService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly storage: StorageService,
  ) {}

  getBugReportScreenshotUploadUrl(
    userId: string,
    input: { mimeType: string; originalName: string; sizeBytes: number },
  ) {
    return this.storage.getUploadUrl({
      folder: `bug-reports/${userId}`,
      mimeType: input.mimeType,
      originalName: input.originalName,
      sizeBytes: input.sizeBytes,
    });
  }

  async createBugReport(userId: string, input: CreateBugReportInput) {
    const screenshotKeys = input.screenshotKeys ?? [];
    if (screenshotKeys.length > MAX_BUG_REPORT_SCREENSHOTS) {
      throw new ConflictException('bug report supports up to 4 screenshots');
    }

    const reportWithScreenshots = await this.db.transaction(async (tx) => {
      const [report] = await tx
        .insert(supportBugReport)
        .values({
          userId,
          severity: input.severity,
          impact: input.impact,
          area: input.area,
          details: input.details,
          stepsToReproduce: input.stepsToReproduce ?? null,
        })
        .returning();

      if (!report) {
        throw new InternalServerErrorException('failed to create bug report');
      }

      const createdScreenshots =
        screenshotKeys.length === 0
          ? []
          : await tx
              .insert(supportBugReportScreenshot)
              .values(
                screenshotKeys.map((storageKey) => ({
                  bugReportId: report.id,
                  storageKey,
                })),
              )
              .returning();

      return { ...report, screenshots: createdScreenshots };
    });

    const screenshots = await Promise.all(
      reportWithScreenshots.screenshots.map(async (screenshot) => ({
        ...screenshot,
        url: await this.storage.getDownloadUrl(screenshot.storageKey),
      })),
    );

    return { ...reportWithScreenshots, screenshots };
  }

  async createFeedback(userId: string, input: CreateFeedbackInput) {
    const [feedback] = await this.db
      .insert(supportFeedback)
      .values({ ...input, userId })
      .returning();

    if (!feedback) {
      throw new InternalServerErrorException('failed to create feedback');
    }

    return feedback;
  }

  async listContacts(userId: string, type: SupportContactType) {
    return this.db
      .select()
      .from(supportContact)
      .where(
        and(
          eq(supportContact.userId, userId),
          eq(supportContact.type, type),
          isNull(supportContact.deletedAt),
        ),
      );
  }

  async createContact(
    userId: string,
    type: SupportContactType,
    input: CreateSupportContactInput,
  ) {
    const activeContacts = await this.listContacts(userId, type);
    if (activeContacts.length >= MAX_CONTACTS_PER_TYPE) {
      throw new ConflictException(`maximum ${type} contacts reached`);
    }

    const [contact] = await this.db
      .insert(supportContact)
      .values({ ...input, userId, type })
      .returning();

    if (!contact) {
      throw new InternalServerErrorException('failed to create contact');
    }

    return contact;
  }

  async updateContact(
    userId: string,
    type: SupportContactType,
    id: string,
    input: UpdateSupportContactInput,
  ) {
    const set: UpdateSupportContactInput & { updatedAt: Date } = {
      updatedAt: new Date(),
    };
    if (input.name !== undefined) set.name = input.name;
    if (input.phone !== undefined) set.phone = input.phone;

    const [contact] = await this.db
      .update(supportContact)
      .set(set)
      .where(
        and(
          eq(supportContact.id, id),
          eq(supportContact.userId, userId),
          eq(supportContact.type, type),
          isNull(supportContact.deletedAt),
        ),
      )
      .returning();

    if (!contact) throw new NotFoundException('contact not found');

    return contact;
  }

  async deleteContact(userId: string, type: SupportContactType, id: string) {
    const [contact] = await this.db
      .update(supportContact)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(supportContact.id, id),
          eq(supportContact.userId, userId),
          eq(supportContact.type, type),
          isNull(supportContact.deletedAt),
        ),
      )
      .returning({ id: supportContact.id });

    if (!contact) throw new NotFoundException('contact not found');

    return { message: 'contact deleted' };
  }
}

import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../database/database.module';
import { StorageService } from '../storage';
import type { UserRole } from '../user/schema/user.schema';
import { adBanner, type AdBanner, type AdBannerAudience } from './schema';

export type CreateAdBannerInput = {
  imageKey: string;
  audience?: AdBannerAudience;
  title?: string | null;
  linkUrl?: string | null;
  sortOrder: number;
  startsAt?: Date | null;
  endsAt?: Date | null;
};

export type SetAdBannerStatusInput = {
  isActive: boolean;
};

export type AdBannerListItem = {
  id: string;
  title: string | null;
  imageUrl: string;
  linkUrl: string | null;
  audience: AdBannerAudience;
  sortOrder: number;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const AD_BANNER_FOLDER = 'ad-banners';

@Injectable()
export class AdBannersService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly storage: StorageService,
  ) {}

  getUploadUrl(input: {
    mimeType: string;
    originalName: string;
    sizeBytes: number;
  }) {
    return this.storage.getUploadUrl({
      folder: AD_BANNER_FOLDER,
      mimeType: input.mimeType,
      originalName: input.originalName,
      sizeBytes: input.sizeBytes,
    });
  }

  async listActiveBanners(roles: UserRole[]): Promise<AdBannerListItem[]> {
    const now = new Date();
    const audiences = this.getAudiencesForRoles(roles);
    const rows = await this.db.transaction((tx) =>
      tx
        .select()
        .from(adBanner)
        .where(
          and(
            eq(adBanner.isActive, true),
            inArray(adBanner.audience, audiences),
            isNull(adBanner.deletedAt),
            or(isNull(adBanner.startsAt), lte(adBanner.startsAt, now)),
            or(isNull(adBanner.endsAt), gte(adBanner.endsAt, now)),
          ),
        )
        .orderBy(
          asc(adBanner.sortOrder),
          desc(adBanner.createdAt),
          desc(adBanner.id),
        ),
    );

    return Promise.all(rows.map((row) => this.toResponse(row)));
  }

  async listBannersForAdmin(): Promise<AdBannerListItem[]> {
    const rows = await this.db.transaction((tx) =>
      tx
        .select()
        .from(adBanner)
        .where(isNull(adBanner.deletedAt))
        .orderBy(desc(adBanner.createdAt), desc(adBanner.id)),
    );

    return Promise.all(rows.map((row) => this.toResponse(row)));
  }

  async createBanner(input: CreateAdBannerInput): Promise<AdBannerListItem> {
    this.assertAdBannerImageKey(input.imageKey);
    this.assertDateWindow(input.startsAt, input.endsAt);

    const row = await this.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(adBanner)
        .values({
          imageKey: input.imageKey,
          audience: input.audience ?? 'all_users',
          title: input.title ?? null,
          linkUrl: input.linkUrl ?? null,
          sortOrder: input.sortOrder,
          startsAt: input.startsAt ?? null,
          endsAt: input.endsAt ?? null,
        })
        .returning();

      if (!inserted) {
        throw new InternalServerErrorException('failed to create ad banner');
      }

      return inserted;
    });

    return this.toResponse(row);
  }

  async setBannerStatus(
    id: string,
    input: SetAdBannerStatusInput,
  ): Promise<AdBannerListItem> {
    const row = await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(adBanner)
        .set({ isActive: input.isActive, updatedAt: new Date() })
        .where(and(eq(adBanner.id, id), isNull(adBanner.deletedAt)))
        .returning();

      if (!updated) throw new NotFoundException('ad banner not found');
      return updated;
    });

    return this.toResponse(row);
  }

  async deleteBanner(id: string): Promise<{ message: string }> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(adBanner)
        .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(adBanner.id, id), isNull(adBanner.deletedAt)))
        .returning({ id: adBanner.id });

      if (!row) throw new NotFoundException('ad banner not found');
    });

    return { message: 'ad banner deleted' };
  }

  private async toResponse(row: AdBanner): Promise<AdBannerListItem> {
    return {
      id: row.id,
      title: row.title,
      imageUrl: await this.storage.getDownloadUrl(row.imageKey),
      linkUrl: row.linkUrl,
      audience: row.audience,
      sortOrder: row.sortOrder,
      isActive: row.isActive,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private assertAdBannerImageKey(imageKey: string) {
    if (!imageKey.startsWith(`${AD_BANNER_FOLDER}/`)) {
      throw new BadRequestException('ad banner image key is not valid');
    }
  }

  private getAudiencesForRoles(roles: UserRole[]): AdBannerAudience[] {
    const audiences: AdBannerAudience[] = ['all_users'];
    if (roles.includes('rider')) audiences.push('riders');
    if (roles.includes('driver')) audiences.push('drivers');
    return audiences;
  }

  private assertDateWindow(startsAt?: Date | null, endsAt?: Date | null) {
    if (startsAt && Number.isNaN(startsAt.getTime())) {
      throw new BadRequestException('startsAt must be a valid date');
    }
    if (endsAt && Number.isNaN(endsAt.getTime())) {
      throw new BadRequestException('endsAt must be a valid date');
    }
    if (startsAt && endsAt && endsAt <= startsAt) {
      throw new BadRequestException('endsAt must be after startsAt');
    }
  }
}

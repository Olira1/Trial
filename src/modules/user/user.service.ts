import {
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  and,
  arrayOverlaps,
  desc,
  eq,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  DRIZZLE,
  type Database,
  type DBExecutor,
} from '../../database/database.module';
import type { ConfigType } from '@nestjs/config';
import { dispatchConfig } from '../../config';
import { clearDriverPresenceRedisAuthority } from '../driver-presence/clear-driver-presence-redis-authority';
import { archiveAuthIdentityHistory } from '../auth/auth-identity-history';
import { authIdentity } from '../auth/schema/auth-identity.schema';
import { authSession } from '../auth/schema/session.schema';
import { document as documentTable } from '../driver/schema/document.schema';
import { driverApplication } from '../driver/schema/driver-application.schema';
import { driverLicenseApproval } from '../driver/schema/driver-license-approval.schema';
import { forceOfflineDriverPresence } from '../driver-presence/force-offline-driver-presence';
import { REDIS_CLIENT, type Redis } from '../redis';
import { StorageService } from '../storage';
import { pushDeviceToken } from '../notifications/schema/push-device-token.schema';
import { vehicle } from '../driver/schema/vehicle.schema';
import { userRewardLedger } from '../rewards/schema';
import { user, type User, type UserRole } from './schema/user.schema';

export type UpsertUserInput = {
  firstName: string;
  middleName?: string;
  lastName: string;
  gender?: 'male' | 'female';
  role: 'rider' | 'driver';
};

export type UpdateProfileInput = {
  firstName?: string;
  middleName?: string | null;
  lastName?: string;
  gender?: 'male' | 'female';
  role?: 'rider' | 'driver';
};

export type AdminListStatus = 'all' | 'active' | 'inactive';
export type AdminDriverStatus = 'active' | 'inactive';

export type ListDriversForAdminInput = {
  status: AdminListStatus;
  limit: number;
  offset: number;
};

export type ListRidersForAdminInput = ListDriversForAdminInput;
export type AdminDriverApplicationStatus =
  | 'not_submitted'
  | 'incomplete'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'revoked';
export type AdminDocumentAggregateStatus =
  | 'missing'
  | 'partial'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'revoked'
  | 'mixed';

type AdminDriverVehicle = {
  make: string;
  model: string;
  color: string;
  year: number;
  plateNumber: string;
  isApproved: boolean;
};

type AdminDriverApplication = {
  status: AdminDriverApplicationStatus;
  submittedAt: Date | null;
};

type AdminDriverDocument = {
  id: string;
  documentType: typeof documentTable.$inferSelect.documentType;
  url: string;
  reviewStatus: typeof documentTable.$inferSelect.reviewStatus;
  reviewedAt: Date | null;
  reviewReason: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

type AdminDriverDocuments = {
  licenseStatus: AdminDocumentAggregateStatus;
  vehicleDocumentsStatus: AdminDocumentAggregateStatus;
  documents: AdminDriverDocument[];
};

export type AdminDriverListItem = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  gender: 'male' | 'female' | null;
  profilePicture: string | null;
  vehicle: AdminDriverVehicle | null;
  rating: number;
  trips: number;
  wallet: number;
  driverApplicationStatus: AdminDriverApplicationStatus;
  submittedAt: Date | null;
  licenseStatus: AdminDocumentAggregateStatus;
  vehicleDocumentsStatus: AdminDocumentAggregateStatus;
  documents: AdminDriverDocument[];
  status: AdminDriverStatus;
};

export type AdminDriverList = {
  items: AdminDriverListItem[];
  total: number;
  limit: number;
  offset: number;
};

export type AdminRiderListItem = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  profilePicture: string | null;
  rating: number;
  trips: number;
  miles: number;
  isIdVerified: boolean;
  isFaydaVerified: boolean;
  status: AdminDriverStatus;
};

export type AdminRiderList = {
  items: AdminRiderListItem[];
  total: number;
  limit: number;
  offset: number;
};

type AdminIdentityCandidate = {
  identifier: string;
  verifiedAt: Date | null;
  updatedAt: Date;
};

type AdminDriverDocumentRow = {
  userId: string;
  documentType: typeof documentTable.$inferSelect.documentType;
  reviewStatus: typeof documentTable.$inferSelect.reviewStatus;
};

const DEFAULT_DRIVER_RATING = 5;
const DEFAULT_DRIVER_TRIPS = 0;
const DEFAULT_DRIVER_WALLET = 0;
const DEFAULT_RIDER_RATING = 5;
const DEFAULT_RIDER_TRIPS = 0;
const DEFAULT_RIDER_IS_ID_VERIFIED = false;
const DEFAULT_RIDER_IS_FAYDA_VERIFIED = false;

@Injectable()
export class UserService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly storage: StorageService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
    @Inject(dispatchConfig.KEY)
    @Optional()
    private readonly dispatch?: ConfigType<typeof dispatchConfig>,
  ) {}

  private executor(tx?: DBExecutor): DBExecutor {
    return tx ?? this.db;
  }

  async findByPhone(phone: string, tx?: DBExecutor) {
    const db = this.executor(tx);
    const [row] = await db
      .select({ identity: authIdentity })
      .from(authIdentity)
      .innerJoin(user, eq(authIdentity.userId, user.id))
      .where(and(eq(authIdentity.identifier, phone), isNull(user.deletedAt)))
      .limit(1);
    return row?.identity;
  }

  async findById(id: string, tx?: DBExecutor): Promise<User | undefined> {
    const db = this.executor(tx);
    const [row] = await db
      .select()
      .from(user)
      .where(and(eq(user.id, id), isNull(user.deletedAt)))
      .limit(1);
    return row;
  }

  async listDriversForAdmin(
    input: ListDriversForAdminInput,
  ): Promise<AdminDriverList> {
    return this.db.transaction(
      async (tx) => {
        const where = this.buildAdminDriverListWhere(input.status);

        const rows = await tx
          .select({
            id: user.id,
            firstName: user.firstName,
            middleName: user.middleName,
            lastName: user.lastName,
            gender: user.gender,
            imageKey: user.imageKey,
            isActive: user.isActive,
          })
          .from(user)
          .where(where)
          .orderBy(desc(user.createdAt), desc(user.id))
          .limit(input.limit)
          .offset(input.offset);

        const [countRow] = await tx
          .select({ total: sql<number>`count(*)::int` })
          .from(user)
          .where(where);

        const userIds = rows.map((row) => row.id);
        if (userIds.length === 0) {
          return {
            items: [],
            total: Number(countRow?.total ?? 0),
            limit: input.limit,
            offset: input.offset,
          };
        }

        const contacts = await this.getAdminUserContacts(userIds, tx);
        const vehicles = await this.getAdminDriverVehicles(userIds, tx);
        const applications = await this.getAdminDriverApplications(userIds, tx);
        const documents = await this.getAdminDriverDocuments(userIds, tx);
        const profilePictures = await this.createProfilePictureUrls(rows);

        return {
          items: rows.map((row) => ({
            id: row.id,
            fullName: formatFullName(row),
            email: contacts.get(row.id)?.email ?? null,
            phone: contacts.get(row.id)?.phone ?? null,
            gender: row.gender ?? null,
            profilePicture: profilePictures.get(row.id) ?? null,
            vehicle: vehicles.get(row.id) ?? null,
            rating: DEFAULT_DRIVER_RATING,
            trips: DEFAULT_DRIVER_TRIPS,
            wallet: DEFAULT_DRIVER_WALLET,
            driverApplicationStatus:
              applications.get(row.id)?.status ?? 'not_submitted',
            submittedAt: applications.get(row.id)?.submittedAt ?? null,
            licenseStatus: documents.get(row.id)?.licenseStatus ?? 'missing',
            vehicleDocumentsStatus:
              documents.get(row.id)?.vehicleDocumentsStatus ?? 'missing',
            documents: documents.get(row.id)?.documents ?? [],
            status: row.isActive ? 'active' : 'inactive',
          })),
          total: Number(countRow?.total ?? 0),
          limit: input.limit,
          offset: input.offset,
        };
      },
      {
        accessMode: 'read only',
        isolationLevel: 'read committed',
      },
    );
  }

  async listRidersForAdmin(
    input: ListRidersForAdminInput,
  ): Promise<AdminRiderList> {
    return this.db.transaction(
      async (tx) => {
        const where = this.buildAdminRiderListWhere(input.status);

        const rows = await tx
          .select({
            id: user.id,
            firstName: user.firstName,
            middleName: user.middleName,
            lastName: user.lastName,
            imageKey: user.imageKey,
            isActive: user.isActive,
          })
          .from(user)
          .where(where)
          .orderBy(desc(user.createdAt), desc(user.id))
          .limit(input.limit)
          .offset(input.offset);

        const [countRow] = await tx
          .select({ total: sql<number>`count(*)::int` })
          .from(user)
          .where(where);

        const userIds = rows.map((row) => row.id);
        if (userIds.length === 0) {
          return {
            items: [],
            total: Number(countRow?.total ?? 0),
            limit: input.limit,
            offset: input.offset,
          };
        }

        const contacts = await this.getAdminUserContacts(userIds, tx);
        const miles = await this.getAdminRiderMiles(userIds, tx);
        const profilePictures = await this.createProfilePictureUrls(rows);

        return {
          items: rows.map((row) => ({
            id: row.id,
            fullName: formatFullName(row),
            email: contacts.get(row.id)?.email ?? null,
            phone: contacts.get(row.id)?.phone ?? null,
            profilePicture: profilePictures.get(row.id) ?? null,
            rating: DEFAULT_RIDER_RATING,
            trips: DEFAULT_RIDER_TRIPS,
            miles: miles.get(row.id) ?? 0,
            isIdVerified: DEFAULT_RIDER_IS_ID_VERIFIED,
            isFaydaVerified: DEFAULT_RIDER_IS_FAYDA_VERIFIED,
            status: row.isActive ? 'active' : 'inactive',
          })),
          total: Number(countRow?.total ?? 0),
          limit: input.limit,
          offset: input.offset,
        };
      },
      {
        accessMode: 'read only',
        isolationLevel: 'read committed',
      },
    );
  }

  async createProfile(input: UpsertUserInput, tx?: DBExecutor): Promise<User> {
    const db = this.executor(tx);
    const [row] = await db
      .insert(user)
      .values({
        firstName: input.firstName,
        middleName: input.middleName,
        lastName: input.lastName,
        ...(input.gender && { gender: input.gender }),
        roles: [input.role],
      })
      .returning();
    if (!row) throw new InternalServerErrorException('failed to create user');
    return row;
  }

  async updateProfile(
    id: string,
    input: UpdateProfileInput,
    tx?: DBExecutor,
  ): Promise<User> {
    if (!tx) {
      return await this.db.transaction((transaction) =>
        this.updateProfile(id, input, transaction),
      );
    }

    const db = this.executor(tx);
    const set: Partial<typeof user.$inferInsert> = {};
    if (input.firstName !== undefined) set.firstName = input.firstName;
    if (input.middleName !== undefined) set.middleName = input.middleName;
    if (input.lastName !== undefined) set.lastName = input.lastName;
    if (input.gender !== undefined) set.gender = input.gender;
    if (input.role !== undefined) {
      const [current] = await db
        .select({ roles: user.roles })
        .from(user)
        .where(and(eq(user.id, id), isNull(user.deletedAt)))
        .for('update')
        .limit(1);
      if (!current) throw new NotFoundException('user not found');
      set.roles = mergeUserRole(current.roles, input.role);
    }

    const [updated] = await db
      .update(user)
      .set(set)
      .where(and(eq(user.id, id), isNull(user.deletedAt)))
      .returning();
    if (!updated) throw new NotFoundException('user not found');
    return updated;
  }

  async deleteUser(id: string): Promise<{ message: string }> {
    await this.db.transaction(async (tx) => {
      const now = new Date();
      const [deleted] = await tx
        .update(user)
        .set({ isActive: false, deletedAt: now, updatedAt: now })
        .where(and(eq(user.id, id), isNull(user.deletedAt)))
        .returning({ id: user.id });

      if (!deleted) throw new NotFoundException('user not found');

      await tx
        .update(authSession)
        .set({ revokedAt: now, updatedAt: now })
        .where(and(eq(authSession.userId, id), isNull(authSession.revokedAt)));

      await tx
        .update(pushDeviceToken)
        .set({ isActive: false, updatedAt: now })
        .where(
          and(
            eq(pushDeviceToken.userId, id),
            eq(pushDeviceToken.isActive, true),
          ),
        );

      await forceOfflineDriverPresence(tx, {
        userId: id,
        actorUserId: id,
        now,
      });

      const identities = await tx
        .select()
        .from(authIdentity)
        .where(eq(authIdentity.userId, id));

      await archiveAuthIdentityHistory(tx, identities, now);
      await tx.delete(authIdentity).where(eq(authIdentity.userId, id));
    });

    if (this.redis && this.dispatch) {
      await clearDriverPresenceRedisAuthority(
        this.redis,
        this.dispatch.queuePrefix,
        this.dispatch.h3Resolution,
        id,
      ).catch(() => undefined);
    }

    return { message: 'user deleted' };
  }

  private buildAdminDriverListWhere(status: AdminListStatus) {
    const conditions: SQL[] = [
      isNull(user.deletedAt),
      or(
        arrayOverlaps(user.roles, ['driver']),
        eq(user.signupIntent, 'driver'),
      )!,
    ];

    if (status === 'active') {
      conditions.push(eq(user.isActive, true));
    }
    if (status === 'inactive') {
      conditions.push(eq(user.isActive, false));
    }

    return and(...conditions);
  }

  private buildAdminRiderListWhere(status: AdminListStatus) {
    const conditions: SQL[] = [
      isNull(user.deletedAt),
      arrayOverlaps(user.roles, ['rider']),
      or(eq(user.signupIntent, 'rider'), isNull(user.signupIntent))!,
    ];

    if (status === 'active') {
      conditions.push(eq(user.isActive, true));
    }
    if (status === 'inactive') {
      conditions.push(eq(user.isActive, false));
    }

    return and(...conditions);
  }

  private async getAdminUserContacts(userIds: string[], tx?: DBExecutor) {
    const db = this.executor(tx);
    const contacts = new Map<
      string,
      { email: string | null; phone: string | null }
    >();
    const selectedContacts = new Map<
      string,
      {
        email: AdminIdentityCandidate | null;
        phone: AdminIdentityCandidate | null;
      }
    >();
    if (userIds.length === 0) return contacts;

    for (const id of userIds) {
      contacts.set(id, { email: null, phone: null });
      selectedContacts.set(id, { email: null, phone: null });
    }

    const identities = await db
      .select({
        userId: authIdentity.userId,
        type: authIdentity.type,
        identifier: authIdentity.identifier,
        verifiedAt: authIdentity.verifiedAt,
        updatedAt: authIdentity.updatedAt,
      })
      .from(authIdentity)
      .where(
        and(
          inArray(authIdentity.userId, userIds),
          inArray(authIdentity.type, ['email', 'phone']),
        ),
      );

    for (const identity of identities) {
      const selected = selectedContacts.get(identity.userId);
      if (!selected) continue;

      if (
        identity.type === 'email' &&
        this.isPreferredAdminIdentity(identity, selected.email)
      ) {
        selected.email = identity;
        continue;
      }

      if (
        identity.type === 'phone' &&
        this.isPreferredAdminIdentity(identity, selected.phone)
      ) {
        selected.phone = identity;
      }
    }

    for (const [userId, selected] of selectedContacts) {
      contacts.set(userId, {
        email: selected.email?.identifier ?? null,
        phone: selected.phone?.identifier ?? null,
      });
    }

    return contacts;
  }

  private async getAdminRiderMiles(userIds: string[], tx?: DBExecutor) {
    const db = this.executor(tx);
    const miles = new Map<string, number>();
    if (userIds.length === 0) return miles;

    for (const id of userIds) {
      miles.set(id, 0);
    }

    const rows = await db
      .select({
        userId: userRewardLedger.userId,
        miles: sql<string>`coalesce(sum(${userRewardLedger.miles}), 0)::text`,
      })
      .from(userRewardLedger)
      .where(inArray(userRewardLedger.userId, userIds))
      .groupBy(userRewardLedger.userId);

    for (const row of rows) {
      miles.set(row.userId, Number(row.miles ?? 0));
    }

    return miles;
  }

  private async getAdminDriverVehicles(userIds: string[], tx?: DBExecutor) {
    const db = this.executor(tx);
    const vehicles = new Map<string, AdminDriverVehicle>();
    if (userIds.length === 0) return vehicles;

    const rows = await db
      .select({
        userId: vehicle.userId,
        make: vehicle.make,
        model: vehicle.model,
        color: vehicle.color,
        year: vehicle.year,
        plateNumber: vehicle.plateNumber,
        isApproved: vehicle.isApproved,
      })
      .from(vehicle)
      .where(and(inArray(vehicle.userId, userIds), isNull(vehicle.deletedAt)))
      .orderBy(desc(vehicle.updatedAt), desc(vehicle.id));

    for (const row of rows) {
      if (vehicles.has(row.userId)) continue;
      vehicles.set(row.userId, {
        make: row.make,
        model: row.model,
        color: row.color,
        year: row.year,
        plateNumber: row.plateNumber,
        isApproved: row.isApproved,
      });
    }

    return vehicles;
  }

  private async getAdminDriverApplications(userIds: string[], tx?: DBExecutor) {
    const db = this.executor(tx);
    const applications = new Map<string, AdminDriverApplication>();
    if (userIds.length === 0) return applications;

    const rows = await db
      .select({
        userId: driverApplication.userId,
        status: driverApplication.status,
        submittedAt: driverApplication.submittedAt,
      })
      .from(driverApplication)
      .where(inArray(driverApplication.userId, userIds))
      .orderBy(desc(driverApplication.updatedAt), desc(driverApplication.id));

    for (const row of rows) {
      if (applications.has(row.userId)) continue;
      applications.set(row.userId, {
        status: row.status,
        submittedAt: row.submittedAt,
      });
    }

    return applications;
  }

  private async getAdminDriverDocuments(userIds: string[], tx?: DBExecutor) {
    const db = this.executor(tx);
    const documents = new Map<string, AdminDriverDocuments>();
    if (userIds.length === 0) return documents;

    const licenseRows = await db
      .select({
        userId: driverLicenseApproval.userId,
        reviewStatus: driverLicenseApproval.reviewStatus,
      })
      .from(driverLicenseApproval)
      .where(inArray(driverLicenseApproval.userId, userIds));
    const vehicleRows = await db
      .select({
        userId: vehicle.userId,
        reviewStatus: vehicle.reviewStatus,
      })
      .from(vehicle)
      .where(and(inArray(vehicle.userId, userIds), isNull(vehicle.deletedAt)))
      .orderBy(desc(vehicle.updatedAt), desc(vehicle.id));
    const documentRows = await db
      .select({
        id: documentTable.id,
        userId: documentTable.userId,
        documentType: documentTable.documentType,
        storageKey: documentTable.storageKey,
        reviewStatus: documentTable.reviewStatus,
        reviewedAt: documentTable.reviewedAt,
        reviewReason: documentTable.reviewReason,
        expiresAt: documentTable.expiresAt,
        revokedAt: documentTable.revokedAt,
        createdAt: documentTable.createdAt,
      })
      .from(documentTable)
      .where(inArray(documentTable.userId, userIds))
      .orderBy(desc(documentTable.createdAt), desc(documentTable.id));

    const currentDocumentsByUser = new Map<string, AdminDriverDocument[]>();
    const seenDocumentTypes = new Set<string>();
    const currentDocumentRows: typeof documentRows = [];
    for (const row of documentRows) {
      const key = `${row.userId}:${row.documentType}`;
      if (seenDocumentTypes.has(key)) continue;
      seenDocumentTypes.add(key);
      currentDocumentRows.push(row);
    }

    const currentDocumentUrls = await Promise.all(
      currentDocumentRows.map((row) =>
        this.storage.getDownloadUrl(row.storageKey),
      ),
    );

    currentDocumentRows.forEach((row, index) => {
      const url = currentDocumentUrls[index];
      if (url === undefined) {
        throw new InternalServerErrorException('failed to create document url');
      }

      const currentDocuments = currentDocumentsByUser.get(row.userId) ?? [];
      currentDocuments.push({
        id: row.id,
        documentType: row.documentType,
        url,
        reviewStatus: row.reviewStatus,
        reviewedAt: row.reviewedAt,
        reviewReason: row.reviewReason,
        expiresAt: row.expiresAt,
        revokedAt: row.revokedAt,
        createdAt: row.createdAt,
      });
      currentDocumentsByUser.set(row.userId, currentDocuments);
    });

    for (const userId of userIds) {
      const licenseStatuses = licenseRows
        .filter((row) => row.userId === userId)
        .map((row) => row.reviewStatus);
      const vehicleDocumentStatuses = vehicleRows
        .filter((row) => row.userId === userId)
        .map((row) => row.reviewStatus);

      documents.set(userId, {
        licenseStatus: summarizeDocumentStatuses(licenseStatuses),
        vehicleDocumentsStatus: summarizeDocumentStatuses(
          vehicleDocumentStatuses,
        ),
        documents: currentDocumentsByUser.get(userId) ?? [],
      });
    }

    return documents;
  }

  private async createProfilePictureUrls(
    rows: Array<{ id: string; imageKey: string | null }>,
  ): Promise<Map<string, string>> {
    const rowsWithImages = rows.filter(
      (row): row is { id: string; imageKey: string } => row.imageKey !== null,
    );
    const entries = await Promise.all(
      rowsWithImages.map(
        async (row) =>
          [row.id, await this.storage.getDownloadUrl(row.imageKey)] as const,
      ),
    );

    return new Map(entries);
  }

  private isPreferredAdminIdentity(
    candidate: AdminIdentityCandidate,
    current: AdminIdentityCandidate | null,
  ) {
    if (!current) return true;
    const candidateVerified = candidate.verifiedAt !== null;
    const currentVerified = current.verifiedAt !== null;
    if (candidateVerified !== currentVerified) return candidateVerified;
    return candidate.updatedAt > current.updatedAt;
  }
}

function mergeUserRole(roles: UserRole[], role: 'rider' | 'driver') {
  if (roles.includes(role)) return roles;
  return [...roles, role];
}

function summarizeDocumentStatuses(
  statuses: Array<AdminDriverDocumentRow['reviewStatus']>,
  requiredCount?: number,
): AdminDocumentAggregateStatus {
  if (statuses.length === 0) return 'missing';
  if (requiredCount !== undefined && statuses.length < requiredCount) {
    return 'partial';
  }

  const uniqueStatuses = new Set(statuses);
  if (uniqueStatuses.size === 1) {
    return statuses[0] ?? 'missing';
  }
  if (uniqueStatuses.has('pending')) return 'pending';
  if (uniqueStatuses.has('rejected')) return 'rejected';
  if (uniqueStatuses.has('revoked')) return 'revoked';
  return 'mixed';
}

const formatFullName = (input: {
  firstName: string;
  middleName: string | null;
  lastName: string;
}) =>
  [input.firstName, input.middleName, input.lastName].filter(Boolean).join(' ');

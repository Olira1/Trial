import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { dispatchConfig } from '../../config';
import { DRIZZLE, type Database } from '../../database/database.module';
import { userSatisfiesRole } from '../auth/decorators/roles.decorator';
import { clearDriverPresenceRedisAuthority } from '../driver-presence/clear-driver-presence-redis-authority';
import { forceOfflineDriverPresence } from '../driver-presence/force-offline-driver-presence';
import { REDIS_CLIENT, type Redis } from '../redis';
import { StorageService } from '../storage';
import { user } from '../user';
import { documentAudit } from './schema/document-audit.schema';
import {
  document as documentTable,
  documentTypeEnum,
  type Document,
} from './schema/document.schema';
import { driverApplicationAudit } from './schema/driver-application-audit.schema';
import { driverApplication } from './schema/driver-application.schema';
import { driverComplianceEvent } from './schema/driver-compliance-event.schema';
import { driverLicenseApprovalAudit } from './schema/driver-license-approval-audit.schema';
import {
  driverLicenseApproval,
  type DriverLicenseApproval,
} from './schema/driver-license-approval.schema';
import { vehicleAudit } from './schema/vehicle-audit.schema';
import {
  vehicle,
  type NewVehicle,
  type Vehicle,
} from './schema/vehicle.schema';

export type RegisterVehicleInput = Omit<
  NewVehicle,
  'id' | 'userId' | 'isApproved' | 'deletedAt' | 'createdAt' | 'updatedAt'
>;

export type DocumentType = (typeof documentTable.$inferInsert)['documentType'];
export type DocumentWithUrl = Document & { url: string };
type VehicleQualification = NonNullable<
  typeof vehicle.$inferSelect.qualifications
>[number];
type DriverLicenseIssuer =
  typeof driverLicenseApproval.$inferSelect.issuedBy extends infer T
    ? NonNullable<T>
    : never;
type DriverLicenseType =
  typeof driverLicenseApproval.$inferSelect.licenseType extends infer T
    ? NonNullable<T>
    : never;
type DocumentStorageKeys = Record<DocumentType, string | null>;
export type DocumentUrls = Record<DocumentType, string | null>;
export type VehicleWithDocumentUrls = Vehicle & {
  documentsUploaded: DocumentUrls;
};

@Injectable()
export class DriverService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly storage: StorageService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
    @Inject(dispatchConfig.KEY)
    @Optional()
    private readonly dispatch?: ConfigType<typeof dispatchConfig>,
  ) {}

  async registerVehicle(
    userId: string,
    input: RegisterVehicleInput,
  ): Promise<Vehicle> {
    const normalizedInput = {
      ...input,
      plateNumber: normalizePlateNumber(input.plateNumber),
    };
    if (!normalizedInput.plateNumber)
      throw new BadRequestException('plate number is required');

    try {
      return await this.db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ id: vehicle.id })
          .from(vehicle)
          .where(and(eq(vehicle.userId, userId), isNull(vehicle.deletedAt)))
          .limit(1);
        if (existing) {
          throw new ConflictException('user already has a registered vehicle');
        }

        const [row] = await tx
          .insert(vehicle)
          .values({ ...normalizedInput, userId })
          .returning();
        if (!row)
          throw new InternalServerErrorException('failed to register vehicle');

        await this.relinkVehicleDocuments(tx, userId, row.id);

        return row;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('plate number is already registered');
      }
      throw err;
    }
  }

  async getVehicle(userId: string): Promise<VehicleWithDocumentUrls | null> {
    const result = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(vehicle)
        .where(and(eq(vehicle.userId, userId), isNull(vehicle.deletedAt)))
        .limit(1);
      if (!row) return null;

      const documents = await tx
        .select({
          documentType: documentTable.documentType,
          storageKey: documentTable.storageKey,
        })
        .from(documentTable)
        .where(eq(documentTable.userId, userId))
        .orderBy(desc(documentTable.createdAt), desc(documentTable.id));

      return {
        row,
        documentStorageKeys: createDocumentStorageKeys(documents),
      };
    });

    if (!result) return null;

    return {
      ...result.row,
      documentsUploaded: await this.createDocumentUrls(
        result.documentStorageKeys,
      ),
    };
  }

  async getDocumentUploadUrl(
    userId: string,
    input: {
      documentType: DocumentType;
      mimeType: string;
      originalName: string;
      sizeBytes: number;
    },
  ): Promise<{ url: string; key: string }> {
    return this.storage.getUploadUrl({
      folder: `documents/${userId}/${input.documentType}`,
      mimeType: input.mimeType,
      originalName: input.originalName,
      sizeBytes: input.sizeBytes,
    });
  }

  async registerDocument(
    userId: string,
    input: { documentType: DocumentType; storageKey: string },
  ): Promise<DocumentWithUrl> {
    if (!isScopedDocumentStorageKey(userId, input)) {
      throw new BadRequestException('storage key does not match document type');
    }
    return this.createDocument(userId, input);
  }

  async approveDocument(
    actorUserId: string,
    documentId: string,
    input: { reason: string; expiresAt: Date | null },
  ): Promise<{ reviewStatus: 'approved' }> {
    return this.db.transaction(async (tx) => {
      await this.requireActiveAdmin(tx, actorUserId);
      const document = await this.lockDocumentForReview(tx, documentId);

      if (document.reviewStatus === 'approved')
        return { reviewStatus: 'approved' };
      if (document.reviewStatus !== 'pending')
        throw new ConflictException('document is not pending');
      if (
        isExpiryTrackedDocumentType(document.documentType) &&
        !input.expiresAt
      ) {
        throw new BadRequestException('document expiry is required');
      }

      const now = new Date();
      await tx
        .update(documentTable)
        .set({
          reviewStatus: 'approved',
          reviewerId: actorUserId,
          reviewedAt: now,
          reviewReason: input.reason,
          expiresAt: input.expiresAt,
          revokedAt: null,
        })
        .where(eq(documentTable.id, documentId));

      await tx.insert(documentAudit).values({
        documentId,
        userId: document.userId,
        actorId: actorUserId,
        action: 'approved',
        reason: input.reason,
        expiresAt: input.expiresAt,
        occurredAt: now,
      });

      return { reviewStatus: 'approved' };
    });
  }

  async rejectDocument(
    actorUserId: string,
    documentId: string,
    input: { reason: string },
  ): Promise<{ reviewStatus: 'rejected' }> {
    return this.db.transaction(async (tx) => {
      await this.requireActiveAdmin(tx, actorUserId);
      const document = await this.lockDocumentForReview(tx, documentId);

      if (document.reviewStatus === 'rejected')
        return { reviewStatus: 'rejected' };
      if (document.reviewStatus !== 'pending')
        throw new ConflictException('document is not pending');

      const now = new Date();
      await tx
        .update(documentTable)
        .set({
          reviewStatus: 'rejected',
          reviewerId: actorUserId,
          reviewedAt: now,
          reviewReason: input.reason,
          expiresAt: null,
          revokedAt: null,
        })
        .where(eq(documentTable.id, documentId));

      await tx.insert(documentAudit).values({
        documentId,
        userId: document.userId,
        actorId: actorUserId,
        action: 'rejected',
        reason: input.reason,
        expiresAt: null,
        occurredAt: now,
      });

      return { reviewStatus: 'rejected' };
    });
  }

  async revokeDocument(
    actorUserId: string,
    documentId: string,
    input: { reason: string },
  ): Promise<{ reviewStatus: 'revoked' }> {
    const result = await this.db.transaction(async (tx) => {
      await this.requireActiveAdmin(tx, actorUserId);
      const document = await this.lockDocumentForReview(tx, documentId);

      if (document.reviewStatus === 'revoked')
        return { reviewStatus: 'revoked' as const, userId: undefined };
      if (document.reviewStatus !== 'approved')
        throw new ConflictException('document is not approved');

      const now = new Date();
      await tx
        .update(documentTable)
        .set({
          reviewStatus: 'revoked',
          reviewerId: actorUserId,
          reviewedAt: now,
          reviewReason: input.reason,
          revokedAt: now,
        })
        .where(eq(documentTable.id, documentId));

      await tx.insert(documentAudit).values({
        documentId,
        userId: document.userId,
        actorId: actorUserId,
        action: 'revoked',
        reason: input.reason,
        expiresAt: document.expiresAt,
        occurredAt: now,
      });

      await forceOfflineDriverPresence(tx, {
        userId: document.userId,
        actorUserId,
        now,
      });

      return { reviewStatus: 'revoked' as const, userId: document.userId };
    });

    if (result.userId) {
      await this.clearDriverPresenceOwner(result.userId);
    }
    return { reviewStatus: result.reviewStatus };
  }

  async approveVehicle(
    actorUserId: string,
    vehicleId: string,
    input: { reason: string },
  ): Promise<{ isApproved: true }> {
    return this.db.transaction(async (tx) => {
      await this.requireActiveAdmin(tx, actorUserId);
      const row = await this.lockVehicleForReview(tx, vehicleId);

      if (row.isApproved) return { isApproved: true };

      const now = new Date();
      await tx
        .update(vehicle)
        .set({
          isApproved: true,
          reviewStatus: 'approved',
          reviewerId: actorUserId,
          reviewedAt: now,
          reviewReason: input.reason,
          revokedAt: null,
          updatedAt: now,
        })
        .where(eq(vehicle.id, vehicleId));

      await tx.insert(vehicleAudit).values({
        vehicleId,
        userId: row.userId,
        actorId: actorUserId,
        action: 'approved',
        reason: input.reason,
        tinNumber: row.tinNumber,
        qualifications: row.qualifications,
        snapshot: {
          reviewStatus: 'approved',
          reviewerId: actorUserId,
        },
        occurredAt: now,
      });

      await this.reconcileDriverApprovalState(tx, row.userId, actorUserId, now);

      return { isApproved: true };
    });
  }

  async approveVehicleDocuments(
    actorUserId: string,
    driverUserId: string,
    input: {
      reason: string;
      tinNumber: string;
      qualifications: VehicleQualification[];
    },
  ): Promise<{ reviewStatus: 'approved' }> {
    return this.db.transaction(async (tx) => {
      await this.requireActiveAdmin(tx, actorUserId);
      const row = await this.lockVehicleForDriver(tx, driverUserId);
      const now = new Date();

      await tx
        .update(vehicle)
        .set({
          tinNumber: input.tinNumber,
          qualifications: input.qualifications,
          reviewStatus: 'approved',
          reviewerId: actorUserId,
          reviewedAt: now,
          reviewReason: input.reason,
          revokedAt: null,
          isApproved: true,
          updatedAt: now,
        })
        .where(eq(vehicle.id, row.id));

      await tx.insert(vehicleAudit).values({
        vehicleId: row.id,
        userId: row.userId,
        actorId: actorUserId,
        action: 'approved',
        reason: input.reason,
        tinNumber: input.tinNumber,
        qualifications: input.qualifications,
        snapshot: {
          reviewStatus: 'approved',
          qualifications: input.qualifications,
        },
        occurredAt: now,
      });

      await this.reconcileDriverApprovalState(tx, row.userId, actorUserId, now);

      return { reviewStatus: 'approved' };
    });
  }

  async rejectVehicle(
    actorUserId: string,
    vehicleId: string,
    input: { reason: string },
  ): Promise<{ isApproved: false }> {
    return this.db.transaction(async (tx) => {
      await this.requireActiveAdmin(tx, actorUserId);
      const row = await this.lockVehicleForReview(tx, vehicleId);

      if (row.isApproved) throw new ConflictException('vehicle is approved');

      const now = new Date();
      await tx
        .update(vehicle)
        .set({
          isApproved: false,
          reviewStatus: 'rejected',
          reviewerId: actorUserId,
          reviewedAt: now,
          reviewReason: input.reason,
          revokedAt: null,
          updatedAt: now,
        })
        .where(eq(vehicle.id, vehicleId));

      await tx.insert(vehicleAudit).values({
        vehicleId,
        userId: row.userId,
        actorId: actorUserId,
        action: 'rejected',
        reason: input.reason,
        tinNumber: row.tinNumber,
        qualifications: row.qualifications,
        occurredAt: now,
      });

      await this.reconcileDriverApprovalState(tx, row.userId, actorUserId, now);

      return { isApproved: false };
    });
  }

  async revokeVehicle(
    actorUserId: string,
    vehicleId: string,
    input: { reason: string },
  ): Promise<{ isApproved: false }> {
    const result = await this.db.transaction(async (tx) => {
      await this.requireActiveAdmin(tx, actorUserId);
      const row = await this.lockVehicleForReview(tx, vehicleId);

      if (!row.isApproved)
        throw new ConflictException('vehicle is not approved');

      const now = new Date();
      await tx
        .update(vehicle)
        .set({
          isApproved: false,
          reviewStatus: 'revoked',
          reviewerId: actorUserId,
          reviewedAt: now,
          reviewReason: input.reason,
          revokedAt: now,
          updatedAt: now,
        })
        .where(eq(vehicle.id, vehicleId));

      await tx.insert(vehicleAudit).values({
        vehicleId,
        userId: row.userId,
        actorId: actorUserId,
        action: 'revoked',
        reason: input.reason,
        tinNumber: row.tinNumber,
        qualifications: row.qualifications,
        occurredAt: now,
      });

      await this.reconcileDriverApprovalState(tx, row.userId, actorUserId, now);

      await forceOfflineDriverPresence(tx, {
        userId: row.userId,
        actorUserId,
        now,
      });

      return { isApproved: false as const, userId: row.userId };
    });

    await this.clearDriverPresenceOwner(result.userId);
    return { isApproved: result.isApproved };
  }

  private async requireActiveAdmin(
    tx: Pick<Database, 'select'>,
    actorUserId: string,
  ): Promise<void> {
    const [actor] = await tx
      .select({ id: user.id, roles: user.roles, isActive: user.isActive })
      .from(user)
      .where(and(eq(user.id, actorUserId), isNull(user.deletedAt)))
      .limit(1);

    if (!actor || !actor.isActive || !userSatisfiesRole(actor.roles, 'admin'))
      throw new ForbiddenException('admin access required');
  }

  private async lockDocumentForReview(
    tx: Pick<Database, 'select'>,
    documentId: string,
  ): Promise<Document> {
    const [document] = await tx
      .select()
      .from(documentTable)
      .where(eq(documentTable.id, documentId))
      .for('update')
      .limit(1);

    if (!document) throw new NotFoundException('document not found');
    return document;
  }

  private async lockVehicleForReview(
    tx: Pick<Database, 'select'>,
    vehicleId: string,
  ): Promise<Vehicle> {
    const [row] = await tx
      .select()
      .from(vehicle)
      .where(eq(vehicle.id, vehicleId))
      .for('update')
      .limit(1);

    if (!row || row.deletedAt) throw new NotFoundException('vehicle not found');
    return row;
  }

  private async lockVehicleForDriver(
    tx: Pick<Database, 'select'>,
    driverUserId: string,
  ): Promise<Vehicle> {
    const [row] = await tx
      .select()
      .from(vehicle)
      .where(and(eq(vehicle.userId, driverUserId), isNull(vehicle.deletedAt)))
      .for('update')
      .limit(1);

    if (!row) throw new NotFoundException('vehicle not found');
    return row;
  }

  async approveLicense(
    actorUserId: string,
    driverUserId: string,
    input: {
      reason: string;
      licenseNumber: string;
      issuedBy: DriverLicenseIssuer;
      licenseType: DriverLicenseType;
      expiresAt: Date | null;
    },
  ): Promise<{ reviewStatus: 'approved' }> {
    return this.db.transaction(async (tx) => {
      await this.requireActiveAdmin(tx, actorUserId);
      const licenseNumber = input.licenseNumber.trim();
      if (!licenseNumber) {
        throw new BadRequestException('license number is required');
      }
      const application = await this.requireDriverApplication(tx, driverUserId);
      const now = new Date();
      const license = await this.lockOrCreateLicenseApproval(
        tx,
        driverUserId,
        application.id,
      );

      await tx
        .update(driverLicenseApproval)
        .set({
          driverApplicationId: application.id,
          reviewStatus: 'approved',
          licenseNumber,
          issuedBy: input.issuedBy,
          licenseType: input.licenseType,
          reviewerId: actorUserId,
          reviewedAt: now,
          reviewReason: input.reason,
          expiresAt: input.expiresAt,
          revokedAt: null,
          updatedAt: now,
        })
        .where(eq(driverLicenseApproval.id, license.id));

      await tx.insert(driverLicenseApprovalAudit).values({
        licenseApprovalId: license.id,
        userId: driverUserId,
        actorId: actorUserId,
        action: 'approved',
        reason: input.reason,
        licenseNumber,
        issuedBy: input.issuedBy,
        licenseType: input.licenseType,
        expiresAt: input.expiresAt,
        occurredAt: now,
      });

      await this.reconcileDriverApprovalState(
        tx,
        driverUserId,
        actorUserId,
        now,
      );

      return { reviewStatus: 'approved' };
    });
  }

  async rejectLicense(
    actorUserId: string,
    driverUserId: string,
    input: { reason: string },
  ): Promise<{ reviewStatus: 'rejected' }> {
    return this.db.transaction(async (tx) => {
      await this.requireActiveAdmin(tx, actorUserId);
      const application = await this.requireDriverApplication(tx, driverUserId);
      const now = new Date();
      const license = await this.lockOrCreateLicenseApproval(
        tx,
        driverUserId,
        application.id,
      );

      await tx
        .update(driverLicenseApproval)
        .set({
          driverApplicationId: application.id,
          reviewStatus: 'rejected',
          reviewerId: actorUserId,
          reviewedAt: now,
          reviewReason: input.reason,
          revokedAt: null,
          updatedAt: now,
        })
        .where(eq(driverLicenseApproval.id, license.id));

      await tx.insert(driverLicenseApprovalAudit).values({
        licenseApprovalId: license.id,
        userId: driverUserId,
        actorId: actorUserId,
        action: 'rejected',
        reason: input.reason,
        licenseNumber: license.licenseNumber,
        issuedBy: license.issuedBy,
        licenseType: license.licenseType,
        expiresAt: license.expiresAt,
        occurredAt: now,
      });

      await this.reconcileDriverApprovalState(
        tx,
        driverUserId,
        actorUserId,
        now,
      );

      return { reviewStatus: 'rejected' };
    });
  }

  async revokeLicense(
    actorUserId: string,
    driverUserId: string,
    input: { reason: string },
  ): Promise<{ reviewStatus: 'revoked' }> {
    const result = await this.db.transaction(async (tx) => {
      await this.requireActiveAdmin(tx, actorUserId);
      const application = await this.requireDriverApplication(tx, driverUserId);
      const now = new Date();
      const license = await this.lockOrCreateLicenseApproval(
        tx,
        driverUserId,
        application.id,
      );

      await tx
        .update(driverLicenseApproval)
        .set({
          driverApplicationId: application.id,
          reviewStatus: 'revoked',
          reviewerId: actorUserId,
          reviewedAt: now,
          reviewReason: input.reason,
          revokedAt: now,
          updatedAt: now,
        })
        .where(eq(driverLicenseApproval.id, license.id));

      await tx.insert(driverLicenseApprovalAudit).values({
        licenseApprovalId: license.id,
        userId: driverUserId,
        actorId: actorUserId,
        action: 'revoked',
        reason: input.reason,
        licenseNumber: license.licenseNumber,
        issuedBy: license.issuedBy,
        licenseType: license.licenseType,
        expiresAt: license.expiresAt,
        occurredAt: now,
      });

      await this.reconcileDriverApprovalState(
        tx,
        driverUserId,
        actorUserId,
        now,
      );
      await forceOfflineDriverPresence(tx, {
        userId: driverUserId,
        actorUserId,
        now,
      });

      return { reviewStatus: 'revoked' as const, userId: driverUserId };
    });

    await this.clearDriverPresenceOwner(result.userId);
    return { reviewStatus: result.reviewStatus };
  }

  async submitDriverApplication(
    driverUserId: string,
    input: { reason: string },
  ): Promise<{ status: 'incomplete' | 'pending' }> {
    return this.db.transaction(async (tx) => {
      const [driver] = await tx
        .select({ id: user.id, isActive: user.isActive })
        .from(user)
        .where(and(eq(user.id, driverUserId), isNull(user.deletedAt)))
        .limit(1);

      if (!driver || !driver.isActive)
        throw new NotFoundException('driver not found');

      const [application] = await tx
        .select()
        .from(driverApplication)
        .where(eq(driverApplication.userId, driverUserId))
        .for('update')
        .limit(1);

      const now = new Date();
      if (application) {
        const activeVehicle = await this.getActiveVehicle(tx, driverUserId);
        const documents = await tx
          .select()
          .from(documentTable)
          .where(eq(documentTable.userId, driverUserId));
        const isReadyForReview = hasCompleteApplicationPacket({
          applicationId: application.id,
          vehicle: activeVehicle,
          documents,
        });

        await tx
          .update(driverApplication)
          .set({
            status: isReadyForReview ? 'pending' : 'incomplete',
            submittedAt: now,
            reviewedAt: null,
            reviewerId: null,
            notes: input.reason,
            updatedAt: now,
          })
          .where(eq(driverApplication.id, application.id));

        if (isReadyForReview) {
          await tx.insert(driverApplicationAudit).values({
            applicationId: application.id,
            userId: driverUserId,
            actorId: driverUserId,
            action: 'submitted',
            reason: input.reason,
            occurredAt: now,
          });
          return { status: 'pending' };
        }

        return { status: 'incomplete' };
      }

      const [created] = await tx
        .insert(driverApplication)
        .values({
          userId: driverUserId,
          status: 'incomplete',
          submittedAt: now,
          notes: input.reason,
        })
        .returning();

      if (!created)
        throw new InternalServerErrorException('failed to create application');

      const activeVehicle = await this.getActiveVehicle(tx, driverUserId);
      const documents = await tx
        .select()
        .from(documentTable)
        .where(eq(documentTable.userId, driverUserId));
      const isReadyForReview = hasCompleteApplicationPacket({
        applicationId: created.id,
        vehicle: activeVehicle,
        documents,
      });

      if (!isReadyForReview) {
        return { status: 'incomplete' };
      }

      await tx
        .update(driverApplication)
        .set({
          status: 'pending',
          submittedAt: now,
          notes: input.reason,
          updatedAt: now,
        })
        .where(eq(driverApplication.id, created.id));

      await tx.insert(driverApplicationAudit).values({
        applicationId: created.id,
        userId: driverUserId,
        actorId: driverUserId,
        action: 'submitted',
        reason: input.reason,
        occurredAt: now,
      });

      return { status: 'pending' };
    });
  }

  async approveDriverApplication(
    actorUserId: string,
    driverUserId: string,
    input: { reason: string },
  ): Promise<{ status: 'approved' }> {
    return this.db.transaction(async (tx) => {
      const [actor] = await tx
        .select({ id: user.id, roles: user.roles, isActive: user.isActive })
        .from(user)
        .where(and(eq(user.id, actorUserId), isNull(user.deletedAt)))
        .limit(1);

      if (!actor || !actor.isActive || !userSatisfiesRole(actor.roles, 'admin'))
        throw new ForbiddenException('admin access required');

      const [targetUser] = await tx
        .select({ id: user.id, roles: user.roles, isActive: user.isActive })
        .from(user)
        .where(and(eq(user.id, driverUserId), isNull(user.deletedAt)))
        .for('update')
        .limit(1);

      if (!targetUser || !targetUser.isActive)
        throw new NotFoundException('driver not found');

      const [application] = await tx
        .select()
        .from(driverApplication)
        .where(eq(driverApplication.userId, driverUserId))
        .for('update')
        .limit(1);

      if (!application) throw new NotFoundException('application not found');
      if (application.status === 'approved') return { status: 'approved' };
      if (application.status !== 'pending')
        throw new ConflictException('application is not pending');

      const now = new Date();
      const updatedRoles = targetUser.roles.includes('driver')
        ? targetUser.roles
        : [...targetUser.roles, 'driver'];

      await tx
        .update(user)
        .set({
          roles: updatedRoles as (typeof user.$inferSelect)['roles'],
          updatedAt: now,
        })
        .where(eq(user.id, driverUserId));

      await tx
        .update(driverApplication)
        .set({
          status: 'approved',
          reviewedAt: now,
          reviewerId: actorUserId,
          notes: input.reason,
          updatedAt: now,
        })
        .where(eq(driverApplication.userId, driverUserId));

      await tx.insert(driverApplicationAudit).values({
        applicationId: application.id,
        userId: driverUserId,
        actorId: actorUserId,
        action: 'approved',
        reason: input.reason,
        occurredAt: now,
      });

      return { status: 'approved' };
    });
  }

  async rejectDriverApplication(
    actorUserId: string,
    driverUserId: string,
    input: { reason: string },
  ): Promise<{ status: 'rejected' }> {
    return this.db.transaction(async (tx) => {
      const [actor] = await tx
        .select({ id: user.id, roles: user.roles, isActive: user.isActive })
        .from(user)
        .where(and(eq(user.id, actorUserId), isNull(user.deletedAt)))
        .limit(1);

      if (!actor || !actor.isActive || !userSatisfiesRole(actor.roles, 'admin'))
        throw new ForbiddenException('admin access required');

      const [targetUser] = await tx
        .select({ id: user.id, isActive: user.isActive })
        .from(user)
        .where(and(eq(user.id, driverUserId), isNull(user.deletedAt)))
        .limit(1);

      if (!targetUser || !targetUser.isActive)
        throw new NotFoundException('driver not found');

      const [application] = await tx
        .select()
        .from(driverApplication)
        .where(eq(driverApplication.userId, driverUserId))
        .for('update')
        .limit(1);

      if (!application) throw new NotFoundException('application not found');
      if (application.status === 'rejected') return { status: 'rejected' };
      if (application.status !== 'pending')
        throw new ConflictException('application is not pending');

      const now = new Date();

      await tx
        .update(driverApplication)
        .set({
          status: 'rejected',
          reviewedAt: now,
          reviewerId: actorUserId,
          notes: input.reason,
          updatedAt: now,
        })
        .where(eq(driverApplication.userId, driverUserId));

      await tx.insert(driverApplicationAudit).values({
        applicationId: application.id,
        userId: driverUserId,
        actorId: actorUserId,
        action: 'rejected',
        reason: input.reason,
        occurredAt: now,
      });

      return { status: 'rejected' };
    });
  }

  async revokeDriverApplication(
    actorUserId: string,
    driverUserId: string,
    input: { reason: string },
  ): Promise<{ status: 'revoked' }> {
    const result = await this.db.transaction(async (tx) => {
      const [actor] = await tx
        .select({ id: user.id, roles: user.roles, isActive: user.isActive })
        .from(user)
        .where(and(eq(user.id, actorUserId), isNull(user.deletedAt)))
        .limit(1);

      if (!actor || !actor.isActive || !userSatisfiesRole(actor.roles, 'admin'))
        throw new ForbiddenException('admin access required');

      const [targetUser] = await tx
        .select({ id: user.id, roles: user.roles, isActive: user.isActive })
        .from(user)
        .where(and(eq(user.id, driverUserId), isNull(user.deletedAt)))
        .for('update')
        .limit(1);

      if (!targetUser || !targetUser.isActive)
        throw new NotFoundException('driver not found');

      const [application] = await tx
        .select()
        .from(driverApplication)
        .where(eq(driverApplication.userId, driverUserId))
        .for('update')
        .limit(1);

      if (!application) throw new NotFoundException('application not found');
      if (application.status === 'revoked') {
        return { status: 'revoked' as const, userId: undefined };
      }
      if (application.status !== 'approved')
        throw new ConflictException('application is not approved');

      const now = new Date();
      const updatedRoles = targetUser.roles.filter((role) => role !== 'driver');

      await tx
        .update(user)
        .set({ roles: updatedRoles, updatedAt: now })
        .where(eq(user.id, driverUserId));

      await tx
        .update(driverApplication)
        .set({
          status: 'revoked',
          reviewedAt: now,
          reviewerId: actorUserId,
          notes: input.reason,
          updatedAt: now,
        })
        .where(eq(driverApplication.userId, driverUserId));

      await tx.insert(driverApplicationAudit).values({
        applicationId: application.id,
        userId: driverUserId,
        actorId: actorUserId,
        action: 'revoked',
        reason: input.reason,
        occurredAt: now,
      });

      await forceOfflineDriverPresence(tx, {
        userId: driverUserId,
        actorUserId,
        now,
      });

      return { status: 'revoked' as const, userId: driverUserId };
    });

    if (result.userId) {
      await this.clearDriverPresenceOwner(result.userId);
    }
    return { status: result.status };
  }

  async suspendDriverQualification(
    actorUserId: string,
    driverUserId: string,
    input: { reason: string },
  ): Promise<{ status: 'suspended' }> {
    const result = await this.db.transaction(async (tx) => {
      const [actor] = await tx
        .select({ id: user.id, roles: user.roles, isActive: user.isActive })
        .from(user)
        .where(and(eq(user.id, actorUserId), isNull(user.deletedAt)))
        .limit(1);

      if (!actor || !actor.isActive || !userSatisfiesRole(actor.roles, 'admin'))
        throw new ForbiddenException('admin access required');

      const [targetUser] = await tx
        .select({ id: user.id, isActive: user.isActive })
        .from(user)
        .where(and(eq(user.id, driverUserId), isNull(user.deletedAt)))
        .limit(1);

      if (!targetUser || !targetUser.isActive)
        throw new NotFoundException('driver not found');

      const [latestEvent] = await tx
        .select({ action: driverComplianceEvent.action })
        .from(driverComplianceEvent)
        .where(eq(driverComplianceEvent.userId, driverUserId))
        .orderBy(
          desc(driverComplianceEvent.occurredAt),
          desc(driverComplianceEvent.createdAt),
          desc(driverComplianceEvent.id),
        )
        .limit(1);

      if (latestEvent?.action === 'suspended') {
        return { status: 'suspended' as const, userId: undefined };
      }

      const now = new Date();
      await tx.insert(driverComplianceEvent).values({
        userId: driverUserId,
        actorId: actorUserId,
        action: 'suspended',
        reason: input.reason,
        occurredAt: now,
      });

      await forceOfflineDriverPresence(tx, {
        userId: driverUserId,
        actorUserId,
        now,
      });

      return { status: 'suspended' as const, userId: driverUserId };
    });

    if (result.userId) {
      await this.clearDriverPresenceOwner(result.userId);
    }
    return { status: result.status };
  }

  private async clearDriverPresenceOwner(userId: string) {
    if (!this.redis || !this.dispatch) {
      return;
    }

    await clearDriverPresenceRedisAuthority(
      this.redis,
      this.dispatch.queuePrefix,
      this.dispatch.h3Resolution,
      userId,
    ).catch(() => undefined);
  }

  async reinstateDriverQualification(
    actorUserId: string,
    driverUserId: string,
    input: { reason: string },
  ): Promise<{ status: 'reinstated' }> {
    return this.db.transaction(async (tx) => {
      const [actor] = await tx
        .select({ id: user.id, roles: user.roles, isActive: user.isActive })
        .from(user)
        .where(and(eq(user.id, actorUserId), isNull(user.deletedAt)))
        .limit(1);

      if (!actor || !actor.isActive || !userSatisfiesRole(actor.roles, 'admin'))
        throw new ForbiddenException('admin access required');

      const [targetUser] = await tx
        .select({ id: user.id, isActive: user.isActive })
        .from(user)
        .where(and(eq(user.id, driverUserId), isNull(user.deletedAt)))
        .limit(1);

      if (!targetUser || !targetUser.isActive)
        throw new NotFoundException('driver not found');

      const [latestEvent] = await tx
        .select({ action: driverComplianceEvent.action })
        .from(driverComplianceEvent)
        .where(eq(driverComplianceEvent.userId, driverUserId))
        .orderBy(
          desc(driverComplianceEvent.occurredAt),
          desc(driverComplianceEvent.createdAt),
          desc(driverComplianceEvent.id),
        )
        .limit(1);

      if (latestEvent?.action === 'reinstated') return { status: 'reinstated' };
      if (latestEvent?.action !== 'suspended')
        throw new ConflictException('driver is not suspended');

      const now = new Date();
      await tx.insert(driverComplianceEvent).values({
        userId: driverUserId,
        actorId: actorUserId,
        action: 'reinstated',
        reason: input.reason,
        occurredAt: now,
      });

      return { status: 'reinstated' };
    });
  }

  async replaceDocument(
    userId: string,
    input: { documentType: DocumentType; storageKey: string },
  ): Promise<DocumentWithUrl> {
    if (!isScopedDocumentStorageKey(userId, input)) {
      throw new BadRequestException('storage key does not match document type');
    }
    return this.createDocument(userId, input);
  }

  private async createDocument(
    userId: string,
    input: { documentType: DocumentType; storageKey: string },
  ): Promise<DocumentWithUrl> {
    const row = await this.db.transaction(async (tx) => {
      await this.ensureApplicationForDocumentUpload(tx, userId);
      const owner = await this.resolveDocumentOwner(
        tx,
        userId,
        input.documentType,
      );
      const [row] = await tx
        .insert(documentTable)
        .values({
          userId,
          driverApplicationId: owner.driverApplicationId,
          vehicleId: owner.vehicleId,
          documentType: input.documentType,
          storageKey: input.storageKey,
          reviewStatus: 'pending',
          reviewerId: null,
          reviewedAt: null,
          reviewReason: null,
          expiresAt: null,
          revokedAt: null,
        })
        .returning();
      if (!row)
        throw new InternalServerErrorException('failed to register document');
      await this.resetDerivedApprovalsForDocumentUpload(
        tx,
        userId,
        row.documentType,
        owner.driverApplicationId,
        owner.vehicleId,
      );
      return row;
    });

    return {
      ...row,
      url: await this.storage.getDownloadUrl(row.storageKey),
    };
  }

  private async ensureApplicationForDocumentUpload(
    tx: Pick<Database, 'select' | 'insert' | 'update'>,
    userId: string,
  ): Promise<string> {
    const [existing] = await tx
      .select()
      .from(driverApplication)
      .where(eq(driverApplication.userId, userId))
      .for('update')
      .limit(1);

    const now = new Date();

    if (!existing) {
      const [created] = await tx
        .insert(driverApplication)
        .values({
          userId,
          status: 'incomplete',
          submittedAt: now,
          notes: 'documents uploaded',
        })
        .returning();

      if (!created) {
        throw new InternalServerErrorException('failed to create application');
      }

      return created.id;
    }

    if (existing.status === 'incomplete' || existing.status === 'pending') {
      return existing.id;
    }

    await tx
      .update(driverApplication)
      .set({
        status: 'incomplete',
        reviewedAt: null,
        reviewerId: null,
        notes: 'documents uploaded',
        updatedAt: now,
      })
      .where(eq(driverApplication.id, existing.id));

    return existing.id;
  }

  private async resolveDocumentOwner(
    tx: Pick<Database, 'select'>,
    userId: string,
    documentType: DocumentType,
  ): Promise<{ driverApplicationId: string | null; vehicleId: string | null }> {
    if (isVehicleDocumentType(documentType)) {
      const [vehicleRow] = await tx
        .select({ id: vehicle.id })
        .from(vehicle)
        .where(and(eq(vehicle.userId, userId), isNull(vehicle.deletedAt)))
        .orderBy(desc(vehicle.createdAt), desc(vehicle.id))
        .limit(1);
      return {
        driverApplicationId: null,
        vehicleId: vehicleRow?.id ?? null,
      };
    }

    const [applicationRow] = await tx
      .select({ id: driverApplication.id })
      .from(driverApplication)
      .where(eq(driverApplication.userId, userId))
      .orderBy(desc(driverApplication.createdAt), desc(driverApplication.id))
      .limit(1);

    return {
      driverApplicationId: applicationRow?.id ?? null,
      vehicleId: null,
    };
  }

  private async relinkVehicleDocuments(
    tx: Pick<Database, 'update'>,
    userId: string,
    vehicleId: string,
  ): Promise<void> {
    await tx
      .update(documentTable)
      .set({ vehicleId })
      .where(
        and(
          eq(documentTable.userId, userId),
          isNull(documentTable.vehicleId),
          inArray(documentTable.documentType, [...vehicleDocumentTypes]),
        ),
      );
  }

  private async createDocumentUrls(
    documentStorageKeys: DocumentStorageKeys,
  ): Promise<DocumentUrls> {
    const entries = await Promise.all(
      documentTypeEnum.enumValues.map(async (documentType) => {
        const storageKey = documentStorageKeys[documentType];
        if (!storageKey) return [documentType, null] as const;
        return [
          documentType,
          await this.storage.getDownloadUrl(storageKey),
        ] as const;
      }),
    );

    return Object.fromEntries(entries) as DocumentUrls;
  }

  private async requireDriverApplication(
    tx: Pick<Database, 'select' | 'insert'>,
    userId: string,
  ) {
    const [existing] = await tx
      .select()
      .from(driverApplication)
      .where(eq(driverApplication.userId, userId))
      .limit(1);
    if (existing) return existing;

    const [created] = await tx
      .insert(driverApplication)
      .values({
        userId,
        status: 'pending',
        notes: 'submitted via approval flow',
      })
      .returning();
    if (!created) {
      throw new InternalServerErrorException('failed to create application');
    }
    return created;
  }

  private async lockOrCreateLicenseApproval(
    tx: Pick<Database, 'select' | 'insert' | 'update'>,
    userId: string,
    applicationId: string,
  ): Promise<DriverLicenseApproval> {
    const [existing] = await tx
      .select()
      .from(driverLicenseApproval)
      .where(eq(driverLicenseApproval.userId, userId))
      .for('update')
      .limit(1);
    if (existing) return existing;

    const [created] = await tx
      .insert(driverLicenseApproval)
      .values({
        userId,
        driverApplicationId: applicationId,
        reviewStatus: 'pending',
      })
      .returning();
    if (!created) {
      throw new InternalServerErrorException(
        'failed to create driver license approval',
      );
    }
    return created;
  }

  private async resetDerivedApprovalsForDocumentUpload(
    tx: Pick<Database, 'select' | 'insert' | 'update'>,
    userId: string,
    documentType: DocumentType,
    driverApplicationId: string | null,
    vehicleId: string | null,
  ) {
    const now = new Date();

    if (
      documentType === 'driver_license_front' ||
      documentType === 'driver_license_back'
    ) {
      const application = driverApplicationId
        ? { id: driverApplicationId }
        : await this.requireDriverApplication(tx, userId);
      const license = await this.lockOrCreateLicenseApproval(
        tx,
        userId,
        application.id,
      );
      await tx
        .update(driverLicenseApproval)
        .set({
          driverApplicationId: application.id,
          reviewStatus: 'pending',
          reviewerId: null,
          reviewedAt: null,
          reviewReason: null,
          revokedAt: null,
          updatedAt: now,
        })
        .where(eq(driverLicenseApproval.id, license.id));
    }

    const vehicleToReset =
      vehicleDocumentTypes.has(documentType) && vehicleId
        ? { id: vehicleId }
        : documentType === 'trade_license'
          ? await this.getActiveVehicle(tx, userId)
          : null;

    if (vehicleToReset) {
      await tx
        .update(vehicle)
        .set({
          reviewStatus: 'pending',
          reviewerId: null,
          reviewedAt: null,
          reviewReason: null,
          revokedAt: null,
          isApproved: false,
          updatedAt: now,
        })
        .where(eq(vehicle.id, vehicleToReset.id));
    }

    await this.reconcileDriverApprovalState(
      tx,
      userId,
      userId,
      now,
      'submitted via document upload',
    );
  }

  private async reconcileDriverApprovalState(
    tx: Pick<Database, 'select' | 'insert' | 'update'>,
    userId: string,
    actorUserId: string,
    now: Date,
    pendingReason?: string,
  ): Promise<
    'incomplete' | 'pending' | 'approved' | 'rejected' | 'revoked' | null
  > {
    const [account] = await tx
      .select({ roles: user.roles })
      .from(user)
      .where(eq(user.id, userId))
      .for('update')
      .limit(1);
    const [application] = await tx
      .select()
      .from(driverApplication)
      .where(eq(driverApplication.userId, userId))
      .for('update')
      .limit(1);
    const [license] = await tx
      .select()
      .from(driverLicenseApproval)
      .where(eq(driverLicenseApproval.userId, userId))
      .limit(1);
    const activeVehicle = await this.getActiveVehicle(tx, userId);
    const documents = await tx
      .select()
      .from(documentTable)
      .where(eq(documentTable.userId, userId));

    if (!account || !application) {
      return null;
    }

    const isReadyForReview = hasCompleteApplicationPacket({
      applicationId: application.id,
      vehicle: activeVehicle,
      documents,
    });
    const licenseApproved =
      license?.reviewStatus === 'approved' &&
      (license.expiresAt === null || license.expiresAt > now) &&
      !!license.issuedBy &&
      !!license.licenseType;
    const vehicleApproved = activeVehicle?.reviewStatus === 'approved';

    const nextStatus = !isReadyForReview
      ? 'incomplete'
      : licenseApproved && vehicleApproved
        ? 'approved'
        : license?.reviewStatus === 'revoked' ||
            activeVehicle?.reviewStatus === 'revoked'
          ? 'revoked'
          : license?.reviewStatus === 'rejected' ||
              activeVehicle?.reviewStatus === 'rejected'
            ? 'rejected'
            : 'pending';

    if (application.status !== nextStatus) {
      const isReviewDecision =
        nextStatus === 'approved' ||
        nextStatus === 'rejected' ||
        nextStatus === 'revoked';

      await tx
        .update(driverApplication)
        .set({
          status: nextStatus,
          submittedAt: nextStatus === 'pending' ? now : application.submittedAt,
          reviewerId: isReviewDecision ? actorUserId : null,
          reviewedAt: isReviewDecision ? now : null,
          notes:
            nextStatus === 'incomplete'
              ? 'awaiting required documents'
              : nextStatus === 'pending'
                ? (pendingReason ?? 'ready for review')
                : 'synchronized from license and vehicle approvals',
          updatedAt: now,
        })
        .where(eq(driverApplication.id, application.id));

      if (nextStatus === 'pending' && pendingReason) {
        await tx.insert(driverApplicationAudit).values({
          applicationId: application.id,
          userId,
          actorId: actorUserId,
          action: 'submitted',
          reason: pendingReason,
          occurredAt: now,
        });
      }
    }

    const hasDriverRole = account.roles.includes('driver');
    const shouldHaveDriverRole = nextStatus === 'approved';
    if (hasDriverRole !== shouldHaveDriverRole) {
      await tx
        .update(user)
        .set({
          roles: shouldHaveDriverRole
            ? [...account.roles, 'driver']
            : account.roles.filter((role) => role !== 'driver'),
          updatedAt: now,
        })
        .where(eq(user.id, userId));
    }

    return nextStatus;
  }

  private async getActiveVehicle(
    tx: Pick<Database, 'select'>,
    userId: string,
  ): Promise<Vehicle | null> {
    const [activeVehicle] = await tx
      .select()
      .from(vehicle)
      .where(and(eq(vehicle.userId, userId), isNull(vehicle.deletedAt)))
      .limit(1);
    return activeVehicle ?? null;
  }
}

const isUniqueViolation = (err: unknown): boolean => {
  for (let cur: unknown = err; cur; cur = (cur as { cause?: unknown }).cause) {
    if (
      typeof cur === 'object' &&
      cur !== null &&
      'code' in cur &&
      cur.code === '23505'
    ) {
      return true;
    }
  }
  return false;
};

const normalizePlateNumber = (value: string): string =>
  value
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '');

const isScopedDocumentStorageKey = (
  userId: string,
  input: { documentType: DocumentType; storageKey: string },
): boolean =>
  input.storageKey.startsWith(`documents/${userId}/${input.documentType}/`);

const createDocumentStorageKeys = (
  documents: Array<{ documentType: DocumentType; storageKey: string }>,
): DocumentStorageKeys => {
  const storageKeys = documentTypeEnum.enumValues.reduce(
    (acc, documentType) => {
      acc[documentType] = null;
      return acc;
    },
    {} as DocumentStorageKeys,
  );

  for (const document of documents) {
    storageKeys[document.documentType] ??= document.storageKey;
  }

  return storageKeys;
};

const vehicleDocumentTypes = new Set<DocumentType>([
  'vehicle_ownership',
  'representation_letter',
  'vehicle_photo_front',
  'vehicle_photo_side',
  'vehicle_photo_back',
  'bolo',
  'third_party_insurance',
]);

const isVehicleDocumentType = (documentType: DocumentType): boolean =>
  vehicleDocumentTypes.has(documentType);

const expiryTrackedDocumentTypes = new Set<DocumentType>([
  'driver_license_front',
  'driver_license_back',
  'bolo',
  'third_party_insurance',
  'trade_license',
]);

const isExpiryTrackedDocumentType = (documentType: DocumentType): boolean =>
  expiryTrackedDocumentTypes.has(documentType);

const driverScopedReviewDocumentTypes = new Set<DocumentType>([
  'driver_license_front',
  'driver_license_back',
  'trade_license',
]);

const requiredApplicationDocumentTypes = [
  'vehicle_ownership',
  'driver_license_front',
  'driver_license_back',
  'vehicle_photo_front',
  'vehicle_photo_side',
  'vehicle_photo_back',
  'bolo',
  'third_party_insurance',
  'trade_license',
] as const satisfies readonly DocumentType[];

const hasCompleteApplicationPacket = (input: {
  applicationId: string;
  vehicle: Vehicle | null;
  documents: Document[];
}): boolean => {
  if (!input.vehicle) {
    return false;
  }

  const requiredDocuments = new Set<DocumentType>(
    requiredApplicationDocumentTypes,
  );
  if (input.vehicle.ownershipType === 'representative') {
    requiredDocuments.add('representation_letter');
  }

  return [...requiredDocuments].every((documentType) =>
    input.documents.some(
      (document) =>
        document.documentType === documentType &&
        document.revokedAt === null &&
        (driverScopedReviewDocumentTypes.has(documentType)
          ? document.driverApplicationId === input.applicationId
          : document.vehicleId === input.vehicle?.id),
    ),
  );
};

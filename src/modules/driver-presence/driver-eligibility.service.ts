import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import {
  DRIZZLE,
  type Database,
  type DBExecutor,
} from '../../database/database.module';
import { authIdentity } from '../auth/schema/auth-identity.schema';
import {
  document as documentTable,
  type Document,
} from '../driver/schema/document.schema';
import { driverApplication } from '../driver/schema/driver-application.schema';
import { driverComplianceEvent } from '../driver/schema/driver-compliance-event.schema';
import { vehicle, type Vehicle } from '../driver/schema/vehicle.schema';
import { user, type User } from '../user';

type DocumentType = Document['documentType'];

export type DriverEligibilityDenialReason =
  | 'user_not_found'
  | 'user_inactive'
  | 'user_deleted'
  | 'phone_not_verified'
  | 'driver_capability_missing'
  | 'driver_application_not_approved'
  | 'active_vehicle_missing'
  | 'active_vehicle_not_unique'
  | 'active_vehicle_not_approved'
  | 'plate_not_eligible_for_instant_ride'
  | 'vehicle_tin_missing'
  | 'required_document_missing'
  | 'required_document_not_approved'
  | 'required_document_expired'
  | 'driver_compliance_suspended';

export type DriverEligibilityDenial = {
  reason: DriverEligibilityDenialReason;
  documentType?: DocumentType;
};

export type DriverEligibilityResult = {
  userId: string;
  eligible: boolean;
  denials: DriverEligibilityDenial[];
};

const baseRequiredDocuments = [
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

const expiryTrackedDocuments = new Set<DocumentType>([
  'driver_license_front',
  'driver_license_back',
  'bolo',
  'third_party_insurance',
  'trade_license',
]);

const vehicleDocuments = new Set<DocumentType>([
  'vehicle_ownership',
  'representation_letter',
  'vehicle_photo_front',
  'vehicle_photo_side',
  'vehicle_photo_back',
  'bolo',
  'third_party_insurance',
]);

@Injectable()
export class DriverEligibilityService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async evaluateInstantRideDriverEligibility(
    userId: string,
    executor?: DBExecutor,
  ): Promise<DriverEligibilityResult> {
    if (executor) {
      return this.evaluateWithExecutor(userId, executor);
    }

    return this.db.transaction((tx) => this.evaluateWithExecutor(userId, tx));
  }

  async batchEvaluateInstantRideDriverEligibility(
    userIds: string[],
    executor?: DBExecutor,
  ): Promise<Map<string, DriverEligibilityResult>> {
    if (userIds.length === 0) {
      return new Map();
    }

    if (executor) {
      return this.batchEvaluateWithExecutor(userIds, executor);
    }

    return this.db.transaction((tx) =>
      this.batchEvaluateWithExecutor(userIds, tx),
    );
  }

  private async batchEvaluateWithExecutor(
    userIds: string[],
    executor: DBExecutor,
  ): Promise<Map<string, DriverEligibilityResult>> {
    const now = new Date();
    const uniqueUserIds = [...new Set(userIds)];

    const accounts = await executor
      .select()
      .from(user)
      .where(inArray(user.id, uniqueUserIds));

    const verifiedPhones = await executor
      .select({ userId: authIdentity.userId })
      .from(authIdentity)
      .where(
        and(
          inArray(authIdentity.userId, uniqueUserIds),
          eq(authIdentity.type, 'phone'),
          isNotNull(authIdentity.verifiedAt),
        ),
      );
    const phoneByUser = new Set(verifiedPhones.map((p) => p.userId));

    const applications = await executor
      .select()
      .from(driverApplication)
      .where(inArray(driverApplication.userId, uniqueUserIds));
    const applicationByUser = new Map(applications.map((a) => [a.userId, a]));

    const activeVehicles = await executor
      .select()
      .from(vehicle)
      .where(
        and(inArray(vehicle.userId, uniqueUserIds), isNull(vehicle.deletedAt)),
      );
    const vehiclesByUser = new Map<string, Vehicle[]>();
    for (const v of activeVehicles) {
      const list = vehiclesByUser.get(v.userId) ?? [];
      list.push(v);
      vehiclesByUser.set(v.userId, list);
    }

    const documents = await executor
      .select()
      .from(documentTable)
      .where(inArray(documentTable.userId, uniqueUserIds));
    const documentsByUser = new Map<string, Document[]>();
    for (const d of documents) {
      const list = documentsByUser.get(d.userId) ?? [];
      list.push(d);
      documentsByUser.set(d.userId, list);
    }

    const latestComplianceEvents = await executor
      .selectDistinctOn([driverComplianceEvent.userId], {
        userId: driverComplianceEvent.userId,
        action: driverComplianceEvent.action,
      })
      .from(driverComplianceEvent)
      .where(inArray(driverComplianceEvent.userId, uniqueUserIds))
      .orderBy(
        driverComplianceEvent.userId,
        desc(driverComplianceEvent.occurredAt),
        desc(driverComplianceEvent.createdAt),
      );
    const complianceByUser = new Map(
      latestComplianceEvents.map((e) => [e.userId, e]),
    );

    const results = new Map<string, DriverEligibilityResult>();
    for (const userId of uniqueUserIds) {
      const denials: DriverEligibilityDenial[] = [];
      const addDenial = (denial: DriverEligibilityDenial) => {
        if (
          !denials.some(
            (existing) =>
              existing.reason === denial.reason &&
              existing.documentType === denial.documentType,
          )
        ) {
          denials.push(denial);
        }
      };

      const account = accounts.find((a) => a.id === userId);
      if (!account) {
        results.set(userId, {
          userId,
          eligible: false,
          denials: [{ reason: 'user_not_found' }],
        });
        continue;
      }

      this.evaluateAccount(account, addDenial);
      if (!phoneByUser.has(userId)) {
        addDenial({ reason: 'phone_not_verified' });
      }

      const application = applicationByUser.get(userId);
      if (application?.status !== 'approved') {
        addDenial({ reason: 'driver_application_not_approved' });
      }

      const userVehicles = vehiclesByUser.get(userId) ?? [];
      const activeVehicle =
        userVehicles.length === 1 ? userVehicles[0] : undefined;
      if (userVehicles.length === 0) {
        addDenial({ reason: 'active_vehicle_missing' });
      } else if (userVehicles.length > 1) {
        addDenial({ reason: 'active_vehicle_not_unique' });
      }

      if (activeVehicle) {
        this.evaluateVehicle(activeVehicle, addDenial);
      }

      if (application && activeVehicle) {
        this.evaluateDocuments(
          {
            applicationId: application.id,
            vehicle: activeVehicle,
            documents: documentsByUser.get(userId) ?? [],
            now,
          },
          addDenial,
        );
      }

      if (complianceByUser.get(userId)?.action === 'suspended') {
        addDenial({ reason: 'driver_compliance_suspended' });
      }

      results.set(userId, {
        userId,
        eligible: denials.length === 0,
        denials,
      });
    }

    return results;
  }

  private async evaluateWithExecutor(
    userId: string,
    executor: DBExecutor,
  ): Promise<DriverEligibilityResult> {
    const now = new Date();
    const denials: DriverEligibilityDenial[] = [];
    const addDenial = (denial: DriverEligibilityDenial) => {
      if (
        !denials.some(
          (existing) =>
            existing.reason === denial.reason &&
            existing.documentType === denial.documentType,
        )
      ) {
        denials.push(denial);
      }
    };

    const [account] = await executor
      .select()
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);

    if (!account) {
      return {
        userId,
        eligible: false,
        denials: [{ reason: 'user_not_found' }],
      };
    }

    this.evaluateAccount(account, addDenial);

    const [verifiedPhoneIdentity] = await executor
      .select({ id: authIdentity.id })
      .from(authIdentity)
      .where(
        and(
          eq(authIdentity.userId, userId),
          eq(authIdentity.type, 'phone'),
          isNotNull(authIdentity.verifiedAt),
        ),
      )
      .limit(1);
    if (!verifiedPhoneIdentity) {
      addDenial({ reason: 'phone_not_verified' });
    }

    const [application] = await executor
      .select()
      .from(driverApplication)
      .where(eq(driverApplication.userId, userId))
      .limit(1);
    if (application?.status !== 'approved') {
      addDenial({ reason: 'driver_application_not_approved' });
    }

    const activeVehicles = await executor
      .select()
      .from(vehicle)
      .where(and(eq(vehicle.userId, userId), isNull(vehicle.deletedAt)));

    const activeVehicle =
      activeVehicles.length === 1 ? activeVehicles[0] : undefined;
    if (activeVehicles.length === 0) {
      addDenial({ reason: 'active_vehicle_missing' });
    } else if (activeVehicles.length > 1) {
      addDenial({ reason: 'active_vehicle_not_unique' });
    }

    if (activeVehicle) {
      this.evaluateVehicle(activeVehicle, addDenial);
    }

    if (application && activeVehicle) {
      const documents = await executor
        .select()
        .from(documentTable)
        .where(eq(documentTable.userId, userId));

      this.evaluateDocuments(
        {
          applicationId: application.id,
          vehicle: activeVehicle,
          documents,
          now,
        },
        addDenial,
      );
    }

    const [latestComplianceEvent] = await executor
      .select()
      .from(driverComplianceEvent)
      .where(eq(driverComplianceEvent.userId, userId))
      .orderBy(
        desc(driverComplianceEvent.occurredAt),
        desc(driverComplianceEvent.createdAt),
      )
      .limit(1);
    if (latestComplianceEvent?.action === 'suspended') {
      addDenial({ reason: 'driver_compliance_suspended' });
    }

    return {
      userId,
      eligible: denials.length === 0,
      denials,
    };
  }

  private evaluateAccount(
    account: User,
    addDenial: (denial: DriverEligibilityDenial) => void,
  ) {
    if (account.deletedAt) addDenial({ reason: 'user_deleted' });
    if (!account.isActive) addDenial({ reason: 'user_inactive' });
    if (!account.phoneVerified) addDenial({ reason: 'phone_not_verified' });
    if (!account.roles.includes('driver')) {
      addDenial({ reason: 'driver_capability_missing' });
    }
  }

  private evaluateVehicle(
    activeVehicle: Vehicle,
    addDenial: (denial: DriverEligibilityDenial) => void,
  ) {
    if (
      activeVehicle.reviewStatus !== 'approved' &&
      activeVehicle.isApproved !== true
    ) {
      addDenial({ reason: 'active_vehicle_not_approved' });
    }

    if (!isInstantRidePlateEligible(activeVehicle)) {
      addDenial({ reason: 'plate_not_eligible_for_instant_ride' });
    }

    const requiresTin =
      activeVehicle.plateCode === '01' ||
      (activeVehicle.plateCode === '03' &&
        activeVehicle.plateCodeSubtype === 'transport_service');
    if (requiresTin && !activeVehicle.tinNumber?.trim()) {
      addDenial({ reason: 'vehicle_tin_missing' });
    }
  }

  private evaluateDocuments(
    input: {
      applicationId: string;
      vehicle: Vehicle;
      documents: Document[];
      now: Date;
    },
    addDenial: (denial: DriverEligibilityDenial) => void,
  ) {
    const requiredDocuments = new Set<DocumentType>(baseRequiredDocuments);
    if (input.vehicle.ownershipType === 'representative') {
      requiredDocuments.add('representation_letter');
    }

    for (const documentType of requiredDocuments) {
      const candidates = input.documents.filter(
        (candidate) =>
          candidate.documentType === documentType &&
          !candidate.revokedAt &&
          (vehicleDocuments.has(documentType)
            ? candidate.vehicleId === input.vehicle.id
            : candidate.driverApplicationId === input.applicationId),
      );

      if (candidates.length === 0) {
        addDenial({ reason: 'required_document_missing', documentType });
        continue;
      }

      const approvedCandidates = candidates.filter(
        (candidate) => candidate.reviewStatus === 'approved',
      );
      if (approvedCandidates.length === 0) {
        addDenial({ reason: 'required_document_not_approved', documentType });
        continue;
      }

      const hasCurrentDocument = approvedCandidates.some((candidate) =>
        isCurrentDocument(candidate, input.now),
      );
      if (!hasCurrentDocument) {
        addDenial({ reason: 'required_document_expired', documentType });
      }
    }
  }
}

const isInstantRidePlateEligible = (activeVehicle: Vehicle) =>
  activeVehicle.plateCode === '01' ||
  (activeVehicle.plateCode === '03' &&
    activeVehicle.plateCodeSubtype === 'transport_service');

const isCurrentDocument = (document: Document, now: Date) => {
  if (expiryTrackedDocuments.has(document.documentType)) {
    return !!document.expiresAt && document.expiresAt > now;
  }

  return !document.expiresAt || document.expiresAt > now;
};

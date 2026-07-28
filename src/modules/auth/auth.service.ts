import {
  BadRequestException,
  ConflictException,
  GoneException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import { and, eq, gt, inArray, isNotNull, isNull, or } from 'drizzle-orm';
import jwt, { JsonWebTokenError } from 'jsonwebtoken';
import { authConfig, dispatchConfig } from '../../config';
import {
  DRIZZLE,
  type Database,
  type DBExecutor,
} from '../../database/database.module';
import { hashPassword, verifyHash } from '../../utils/password';
import { clearDriverPresenceRedisAuthority } from '../driver-presence/clear-driver-presence-redis-authority';
import { forceOfflineDriverPresence } from '../driver-presence/force-offline-driver-presence';
import { document as documentTable } from '../driver/schema/document.schema';
import { driverLicenseApproval } from '../driver/schema/driver-license-approval.schema';
import { NotificationsService } from '../notifications';
import { REDIS_CLIENT, type Redis } from '../redis';
import { RewardsService } from '../rewards';
import { StorageService } from '../storage';
import { user, UserService, type User } from '../user';
import { archiveAuthIdentityHistory } from './auth-identity-history';
import { userSatisfiesRole } from './decorators/roles.decorator';
import {
  AdminLoginStartDto,
  ChangePasswordDto,
  ConnectEmailStartDto,
  ConnectEmailVerifyDto,
  LoginStartDto,
  LoginVerifyDto,
  LoginVerifyPasswordDto,
  LogoutDto,
  PasswordResetStartDto,
  PasswordResetVerifyDto,
  ProfileImageUploadUrlDto,
  RefreshDto,
  ResendOtpDto,
  SignUpStartDto,
  SignUpVerifyDto,
  UpdateMeDto,
  VerifyOtpDto,
} from './dto/auth.dto';
import { authIdentity, type AuthIdentity } from './schema/auth-identity.schema';
import {
  otpChallenge,
  type OtpChallenge,
  type OtpPurpose,
} from './schema/otp-challenge.schema';
import { authSession } from './schema/session.schema';

type JwtPayload = { sub: string; sid: string };

export type AccessTokenResult = {
  accessToken: string;
  expiresIn: number;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(
    private readonly users: UserService,
    @Inject(DRIZZLE)
    private readonly db: Database,
    @Inject(authConfig.KEY)
    private readonly config: ConfigType<typeof authConfig>,
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
    private readonly rewards: RewardsService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    @Optional()
    @Inject(dispatchConfig.KEY)
    private readonly dispatch?: ConfigType<typeof dispatchConfig>,
  ) {}

  async signUpStart(dto: SignUpStartDto) {
    return await this.db.transaction(async (tx) => {
      await this.releaseDeletedIdentity(dto.phoneNumber, 'phone', tx);

      const existingIdentity = await this.users.findByPhone(
        dto.phoneNumber,
        tx,
      );
      if (existingIdentity?.verifiedAt) {
        throw new ConflictException('phone number is already registered');
      }

      await this.ensureNoActiveOtpChallenge(
        dto.phoneNumber,
        'phone',
        'sign_up',
        tx,
      );

      if (existingIdentity) {
        await tx
          .update(user)
          .set({
            firstName: dto.firstName,
            middleName: dto.middleName ?? null,
            lastName: dto.lastName,
            deviceId: dto.deviceId,
            gender: dto.gender,
            roles: ['rider'],
            signupIntent: dto.signupIntent,
            updatedAt: new Date(),
          })
          .where(eq(user.id, existingIdentity.userId));

        const challenge = await this.issueOtpChallenge(
          {
            identityId: existingIdentity.id,
            destination: dto.phoneNumber,
            channel: 'phone',
            purpose: 'sign_up',
          },
          tx,
        );
        return {
          signUpChallengeId: challenge.challengeId,
          expiresIn: challenge.expiresIn,
        };
      }

      const [newUser] = await tx
        .insert(user)
        .values({
          firstName: dto.firstName,
          middleName: dto.middleName,
          lastName: dto.lastName,
          deviceId: dto.deviceId,
          gender: dto.gender,
          roles: ['rider'],
          signupIntent: dto.signupIntent,
        })
        .returning({ id: user.id });

      if (!newUser)
        throw new InternalServerErrorException('failed to create user');

      const [newAuthIdentity] = await tx
        .insert(authIdentity)
        .values({
          userId: newUser.id,
          identifier: dto.phoneNumber,
          type: 'phone',
        })
        .returning({ id: authIdentity.id });

      if (!newAuthIdentity)
        throw new InternalServerErrorException(
          'failed to create auth identity',
        );

      const challenge = await this.issueOtpChallenge(
        {
          identityId: newAuthIdentity.id,
          destination: dto.phoneNumber,
          channel: 'phone',
          purpose: 'sign_up',
        },
        tx,
      );
      return {
        signUpChallengeId: challenge.challengeId,
        expiresIn: challenge.expiresIn,
      };
    });
  }

  async signUpVerify(dto: SignUpVerifyDto) {
    return this.db.transaction(async (tx) => {
      const [existingOtpChallenge] = await tx
        .select()
        .from(otpChallenge)
        .where(eq(otpChallenge.id, dto.challengeId))
        .for('update');

      if (!existingOtpChallenge) {
        throw new NotFoundException('Challenge not found');
      }

      if (
        existingOtpChallenge.purpose !== 'sign_up' ||
        existingOtpChallenge.consumedAt ||
        existingOtpChallenge.expiresAt < new Date()
      ) {
        throw new GoneException('OTP has expired or already been used');
      }

      if (!existingOtpChallenge.identityId) {
        throw new NotFoundException('Challenge has no associated identity');
      }

      if (existingOtpChallenge.attempts >= 5) {
        throw new HttpException(
          'Too many OTP attempts',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      await tx
        .update(otpChallenge)
        .set({ attempts: existingOtpChallenge.attempts + 1 })
        .where(eq(otpChallenge.id, dto.challengeId));

      const isValidOtp = await verifyHash(
        dto.code,
        existingOtpChallenge.codeHash,
      );
      if (!isValidOtp) {
        throw new UnauthorizedException('Invalid OTP');
      }

      await tx
        .update(otpChallenge)
        .set({ consumedAt: new Date() })
        .where(eq(otpChallenge.id, dto.challengeId));

      const [identity] = await tx
        .update(authIdentity)
        .set({ verifiedAt: new Date() })
        .where(eq(authIdentity.id, existingOtpChallenge.identityId))
        .returning();

      if (!identity)
        throw new InternalServerErrorException(
          'identity not found after update',
        );

      const [updatedUser] = await tx
        .update(user)
        .set({ phoneVerified: true, deviceId: dto.deviceId })
        .where(eq(user.id, identity.userId))
        .returning({
          id: user.id,
          signupIntent: user.signupIntent,
        });

      if (!updatedUser)
        throw new InternalServerErrorException('user not found after update');

      if (dto.pushToken && dto.platform) {
        await this.notifications.registerDeviceToken(
          updatedUser.id,
          {
            deviceId: dto.deviceId,
            pushToken: dto.pushToken,
            platform: dto.platform,
          },
          tx,
        );
      }

      const session = await this.issueSession(updatedUser.id, tx, dto.deviceId);
      return {
        ...session,
        signupIntent: updatedUser.signupIntent,
      };
    });
  }

  async refresh(dto: RefreshDto): Promise<AccessTokenResult> {
    const tokenHash = createHash('sha256')
      .update(dto.refreshToken)
      .digest('hex');

    const [row] = await this.db
      .select({ session: authSession })
      .from(authSession)
      .innerJoin(user, eq(authSession.userId, user.id))
      .where(
        and(
          eq(authSession.tokenHash, tokenHash),
          eq(user.isActive, true),
          isNull(user.deletedAt),
        ),
      )
      .limit(1);
    const session = row?.session;

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    return this.issueAccessToken(session.userId, session.id);
  }

  async logout(dto: LogoutDto) {
    await this.revokeSession(dto.refreshToken);

    return { message: 'logged out' };
  }

  async assertActiveMobileSession(
    userId: string,
    sessionId: string,
  ): Promise<{ deviceId: string | null }> {
    const [session] = await this.db
      .select({ id: authSession.id, deviceId: authSession.deviceId })
      .from(authSession)
      .innerJoin(user, eq(authSession.userId, user.id))
      .where(
        and(
          eq(authSession.id, sessionId),
          eq(authSession.userId, userId),
          isNull(authSession.revokedAt),
          gt(authSession.expiresAt, new Date()),
          eq(user.isActive, true),
          isNull(user.deletedAt),
        ),
      )
      .limit(1);

    if (!session) {
      throw new UnauthorizedException('invalid or expired session');
    }

    return { deviceId: session.deviceId };
  }

  async adminLogout(sessionToken?: string) {
    if (sessionToken) {
      await this.revokeSession(sessionToken);
    }

    return { message: 'logged out' };
  }

  async resendOtp(dto: ResendOtpDto) {
    return this.db.transaction(async (tx) => {
      const challenge = await this.getLockedOtpChallenge(dto.challengeId, tx);

      if (challenge.consumedAt || !challenge.purpose) {
        throw new GoneException(
          'OTP has already been used or cannot be resent',
        );
      }

      const retryAfter = Math.ceil(
        (challenge.createdAt.getTime() +
          this.config.otpResendCooldownSeconds * 1000 -
          Date.now()) /
          1000,
      );
      if (retryAfter > 0) {
        throw new HttpException(
          { message: 'An OTP was recently sent. Try again later.', retryAfter },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      await tx
        .update(otpChallenge)
        .set({ consumedAt: new Date() })
        .where(eq(otpChallenge.id, challenge.id));

      await this.ensureNoActiveOtpChallenge(
        challenge.destination,
        challenge.channel,
        challenge.purpose,
        tx,
      );

      return this.issueOtpChallenge(
        {
          identityId: challenge.identityId,
          destination: challenge.destination,
          channel: challenge.channel,
          purpose: challenge.purpose,
        },
        tx,
      );
    });
  }

  async connectEmailStart(userId: string, dto: ConnectEmailStartDto) {
    return this.db.transaction(async (tx) => {
      await this.releaseDeletedIdentity(dto.email, 'email', tx);

      const [takenByOther] = await tx
        .select({ id: authIdentity.id })
        .from(authIdentity)
        .where(
          and(
            eq(authIdentity.type, 'email'),
            eq(authIdentity.identifier, dto.email),
            isNotNull(authIdentity.verifiedAt),
          ),
        )
        .limit(1);

      if (takenByOther) {
        throw new ConflictException('email is already in use');
      }

      const [alreadyVerified] = await tx
        .select({ id: authIdentity.id })
        .from(authIdentity)
        .where(
          and(
            eq(authIdentity.type, 'email'),
            eq(authIdentity.userId, userId),
            isNotNull(authIdentity.verifiedAt),
          ),
        )
        .limit(1);

      if (alreadyVerified) {
        throw new ConflictException('account already has a verified email');
      }

      await this.ensureNoActiveOtpChallenge(
        dto.email,
        'email',
        'connect_email',
        tx,
      );

      const passwordHash = await hashPassword(dto.password);

      // Active attempts were rejected above; stale pending rows must not reserve an email.
      await tx
        .delete(authIdentity)
        .where(
          and(
            eq(authIdentity.type, 'email'),
            isNull(authIdentity.verifiedAt),
            or(
              eq(authIdentity.userId, userId),
              eq(authIdentity.identifier, dto.email),
            ),
          ),
        );

      const [newIdentity] = await tx
        .insert(authIdentity)
        .values({ userId, type: 'email', identifier: dto.email, passwordHash })
        .returning({ id: authIdentity.id });

      if (!newIdentity)
        throw new InternalServerErrorException(
          'failed to create email identity',
        );

      return this.issueOtpChallenge(
        {
          identityId: newIdentity.id,
          destination: dto.email,
          channel: 'email',
          purpose: 'connect_email',
        },
        tx,
      );
    });
  }

  async connectEmailVerify(userId: string, dto: ConnectEmailVerifyDto) {
    return this.db.transaction(async (tx) => {
      const challenge = await this.getLockedOtpChallenge(dto.challengeId, tx);

      const [identity] = await tx
        .select()
        .from(authIdentity)
        .where(eq(authIdentity.id, challenge.identityId))
        .limit(1);

      if (!identity) {
        throw new NotFoundException('Identity not found');
      }

      if (identity.userId !== userId) {
        throw new UnauthorizedException(
          'Challenge does not belong to this user',
        );
      }

      await this.consumeLockedOtpChallenge(dto, 'connect_email', challenge, tx);

      await tx
        .update(authIdentity)
        .set({ verifiedAt: new Date() })
        .where(eq(authIdentity.id, challenge.identityId));

      await tx
        .update(user)
        .set({ emailVerified: true })
        .where(eq(user.id, userId));

      return { message: 'email connected' };
    });
  }

  async getCurrentUser(currentUser: User) {
    return this.db.transaction(
      async (tx) => {
        const identities = await tx
          .select({
            type: authIdentity.type,
            identifier: authIdentity.identifier,
          })
          .from(authIdentity)
          .where(
            and(
              eq(authIdentity.userId, currentUser.id),
              isNotNull(authIdentity.verifiedAt),
              or(
                eq(authIdentity.type, 'phone'),
                eq(authIdentity.type, 'email'),
              ),
            ),
          );
        const documents = await tx
          .select({
            documentType: documentTable.documentType,
            reviewStatus: documentTable.reviewStatus,
            expiresAt: documentTable.expiresAt,
            revokedAt: documentTable.revokedAt,
          })
          .from(documentTable)
          .where(eq(documentTable.userId, currentUser.id));
        const [licenseApproval] = await tx
          .select({
            reviewStatus: driverLicenseApproval.reviewStatus,
            expiresAt: driverLicenseApproval.expiresAt,
            revokedAt: driverLicenseApproval.revokedAt,
          })
          .from(driverLicenseApproval)
          .where(eq(driverLicenseApproval.userId, currentUser.id))
          .limit(1);
        const miles = await this.rewards.getMilesForUser(currentUser.id, tx);

        const phoneIdentity = identities.find(
          (identity) => identity.type === 'phone',
        );
        const emailIdentity = identities.find(
          (identity) => identity.type === 'email',
        );
        const now = new Date();
        const approvedDocuments = documents.filter(
          (document) =>
            document.reviewStatus === 'approved' &&
            document.revokedAt === null &&
            (document.expiresAt === null || document.expiresAt > now),
        );
        const documentTypes = new Set(
          approvedDocuments.map((document) => document.documentType),
        );
        const isDriver = currentUser.roles.includes('driver');
        const isLicenseVerified =
          isDriver &&
          licenseApproval?.reviewStatus === 'approved' &&
          licenseApproval.revokedAt === null &&
          (licenseApproval.expiresAt === null ||
            licenseApproval.expiresAt > now) &&
          documentTypes.has('driver_license_front') &&
          documentTypes.has('driver_license_back');
        const profileImageUrl = await this.resolveProfileImageUrl(
          currentUser.imageKey,
        );

        return {
          ...currentUser,
          image: profileImageUrl,
          phone: phoneIdentity?.identifier ?? null,
          phoneNumber: phoneIdentity?.identifier ?? null,
          email: emailIdentity?.identifier ?? null,
          miles,
          rating: 5,
          trips: 0,
          isIdVerified: false,
          isFaydaVerified: false,
          isLicenseVerified,
          isDocumentVerified: approvedDocuments.length > 0,
          avatar: profileImageUrl,
          profilePicture: profileImageUrl,
        };
      },
      { accessMode: 'read only', isolationLevel: 'read committed' },
    );
  }

  getProfileImageUploadUrl(userId: string, input: ProfileImageUploadUrlDto) {
    return this.storage.getUploadUrl({
      folder: `profile-images/${userId}`,
      mimeType: input.mimeType,
      originalName: input.originalName,
      sizeBytes: input.sizeBytes,
    });
  }

  async updateCurrentUser(userId: string, input: UpdateMeDto) {
    const set: Partial<typeof user.$inferInsert> = {};
    if (input.firstName !== undefined) set.firstName = input.firstName;
    if (input.middleName !== undefined) set.middleName = input.middleName;
    if (input.lastName !== undefined) set.lastName = input.lastName;

    if (input.imageKey !== undefined) {
      if (input.imageKey === null) {
        set.imageKey = null;
      } else {
        this.assertProfileImageKeyBelongsToUser(userId, input.imageKey);
        set.imageKey = input.imageKey;
      }
    }

    if (Object.keys(set).length === 0) {
      const existingUser = await this.users.findById(userId);
      if (!existingUser) throw new NotFoundException('user not found');
      return this.getCurrentUser(existingUser);
    }

    const [updatedUser] = await this.db
      .update(user)
      .set(set)
      .where(eq(user.id, userId))
      .returning();

    if (!updatedUser) throw new NotFoundException('user not found');

    return this.getCurrentUser(updatedUser);
  }

  async loginStart(dto: LoginStartDto) {
    const identity = await this.findVerifiedIdentity(dto.phoneNumber, 'phone');

    if (!identity) throw new UnauthorizedException('invalid credentials');

    // TODO: check for passkey credential first when WebAuthn is implemented

    const [emailIdentity] = await this.db
      .select({ id: authIdentity.id })
      .from(authIdentity)
      .where(
        and(
          eq(authIdentity.userId, identity.userId),
          eq(authIdentity.type, 'email'),
          isNotNull(authIdentity.verifiedAt),
          isNotNull(authIdentity.passwordHash),
        ),
      )
      .limit(1);

    if (emailIdentity) return { method: 'email_password' as const };

    await this.ensureNoActiveOtpChallenge(
      dto.phoneNumber,
      'phone',
      'login',
      this.db,
    );

    const challenge = await this.issueOtpChallenge(
      {
        destination: dto.phoneNumber,
        channel: 'phone',
        identityId: identity.id,
        purpose: 'login',
      },
      this.db,
    );

    return { method: 'otp' as const, ...challenge };
  }

  async loginVerify(dto: LoginVerifyDto) {
    const result = await this.db.transaction(async (tx) => {
      const challenge = await this.consumeOtpChallenge(dto, 'login', tx);
      const userId = await this.getChallengeUserId(challenge, tx);

      return this.issueLoginSession(
        userId,
        {
          deviceId: dto.deviceId,
          pushToken: dto.pushToken,
          platform: dto.platform,
        },
        tx,
      );
    });

    await this.sendLoginWelcomeNotification(dto);

    return result;
  }

  async loginVerifyPassword(dto: LoginVerifyPasswordDto) {
    const phoneIdentity = await this.findVerifiedIdentity(
      dto.phoneNumber,
      'phone',
    );

    if (!phoneIdentity) throw new UnauthorizedException('invalid credentials');

    const [emailIdentity] = await this.db
      .select()
      .from(authIdentity)
      .where(
        and(
          eq(authIdentity.userId, phoneIdentity.userId),
          eq(authIdentity.type, 'email'),
          isNotNull(authIdentity.verifiedAt),
          isNotNull(authIdentity.passwordHash),
        ),
      )
      .limit(1);

    if (!emailIdentity?.passwordHash)
      throw new UnauthorizedException('invalid credentials');

    const isValid = await verifyHash(dto.password, emailIdentity.passwordHash);
    if (!isValid) throw new UnauthorizedException('invalid credentials');

    const result = await this.db.transaction(async (tx) => {
      return this.issueLoginSession(
        phoneIdentity.userId,
        {
          deviceId: dto.deviceId,
          pushToken: dto.pushToken,
          platform: dto.platform,
        },
        tx,
      );
    });

    await this.sendLoginWelcomeNotification(dto);

    return result;
  }

  async adminLoginStart(dto: AdminLoginStartDto) {
    const identity = await this.findVerifiedIdentity(dto.email, 'email');

    if (!identity?.passwordHash)
      throw new UnauthorizedException('invalid credentials');

    const isValidPassword = await verifyHash(
      dto.password,
      identity.passwordHash,
    );
    if (!isValidPassword)
      throw new UnauthorizedException('invalid credentials');

    const [adminUser] = await this.db
      .select({ roles: user.roles })
      .from(user)
      .where(eq(user.id, identity.userId))
      .limit(1);

    if (!adminUser || !userSatisfiesRole(adminUser.roles, 'admin'))
      throw new UnauthorizedException('invalid credentials');

    await this.ensureNoActiveOtpChallenge(
      dto.email,
      'email',
      'admin_login',
      this.db,
    );

    return this.issueOtpChallenge(
      {
        destination: dto.email,
        channel: 'email',
        identityId: identity.id,
        purpose: 'admin_login',
      },
      this.db,
    );
  }

  async adminLoginVerify(dto: VerifyOtpDto) {
    return this.db.transaction(async (tx) => {
      const challenge = await this.consumeOtpChallenge(dto, 'admin_login', tx);
      const userId = await this.getChallengeUserId(challenge, tx);
      return this.issueAdminSession(userId, tx);
    });
  }

  private assertProfileImageKeyBelongsToUser(userId: string, key: string) {
    const prefix = `profile-images/${userId}/`;
    if (!key.startsWith(prefix)) {
      throw new BadRequestException('profile image key is not valid');
    }
  }

  private async revokeSession(token: string) {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const revokedSession = await this.db.transaction(async (tx) => {
      const now = new Date();
      const [revoked] = await tx
        .update(authSession)
        .set({ revokedAt: now })
        .where(
          and(
            eq(authSession.tokenHash, tokenHash),
            isNull(authSession.revokedAt),
          ),
        )
        .returning({ id: authSession.id, userId: authSession.userId });

      if (!revoked) return null;

      await forceOfflineDriverPresence(tx, {
        userId: revoked.userId,
        actorUserId: revoked.userId,
        onlyOwnerSessionId: revoked.id,
        now,
      });
      return revoked;
    });

    if (!revokedSession) return;

    if (this.dispatch) {
      await clearDriverPresenceRedisAuthority(
        this.redis,
        this.dispatch.queuePrefix,
        this.dispatch.h3Resolution,
        revokedSession.userId,
      ).catch(() => undefined);
    }
  }

  private async findVerifiedIdentity(
    identifier: string,
    type: 'phone' | 'email',
  ): Promise<AuthIdentity | undefined> {
    const [row] = await this.db
      .select({ identity: authIdentity })
      .from(authIdentity)
      .innerJoin(user, eq(authIdentity.userId, user.id))
      .where(
        and(
          eq(authIdentity.identifier, identifier),
          eq(authIdentity.type, type),
          isNotNull(authIdentity.verifiedAt),
          eq(user.isActive, true),
          isNull(user.deletedAt),
        ),
      )
      .limit(1);

    return row?.identity;
  }

  private async releaseDeletedIdentity(
    identifier: string,
    type: 'phone' | 'email',
    tx: DBExecutor,
  ) {
    const deletedIdentities = await tx
      .select({ identity: authIdentity })
      .from(authIdentity)
      .innerJoin(user, eq(authIdentity.userId, user.id))
      .where(
        and(
          eq(authIdentity.identifier, identifier),
          eq(authIdentity.type, type),
          isNotNull(user.deletedAt),
        ),
      );

    const identities = deletedIdentities.map((row) => row.identity);
    const identityIds = identities.map((identity) => identity.id);
    if (identityIds.length === 0) return;

    await archiveAuthIdentityHistory(tx, identities);
    await tx.delete(authIdentity).where(inArray(authIdentity.id, identityIds));
  }

  private async ensureNoActiveOtpChallenge(
    destination: string,
    channel: 'phone' | 'email',
    purpose: OtpPurpose,
    tx: DBExecutor,
  ) {
    const [activeChallenge] = await tx
      .select({ expiresAt: otpChallenge.expiresAt })
      .from(otpChallenge)
      .where(
        and(
          eq(otpChallenge.destination, destination),
          eq(otpChallenge.channel, channel),
          eq(otpChallenge.purpose, purpose),
          isNull(otpChallenge.consumedAt),
          gt(otpChallenge.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (activeChallenge) {
      const retryAfter = Math.ceil(
        (activeChallenge.expiresAt.getTime() - Date.now()) / 1000,
      );
      throw new HttpException(
        { message: 'An OTP was recently sent. Try again later.', retryAfter },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async issueOtpChallenge(
    input: {
      identityId: string;
      destination: string;
      channel: 'phone' | 'email';
      purpose: OtpPurpose;
    },
    tx: DBExecutor,
  ) {
    // TODO: replace the fixed code with SMS/email delivery integration.
    const codeHash = await hashPassword('000000');
    const expiresIn = this.config.otpTtlSeconds;
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    const [challenge] = await tx
      .insert(otpChallenge)
      .values({ ...input, codeHash, expiresAt })
      .returning({ id: otpChallenge.id });

    if (!challenge)
      throw new InternalServerErrorException('failed to create OTP challenge');

    return { challengeId: challenge.id, expiresIn };
  }

  private async consumeOtpChallenge(
    dto: { challengeId: string; code: string },
    purpose: OtpPurpose,
    tx: DBExecutor,
  ) {
    const challenge = await this.getLockedOtpChallenge(dto.challengeId, tx);

    return this.consumeLockedOtpChallenge(dto, purpose, challenge, tx);
  }

  private async getLockedOtpChallenge(challengeId: string, tx: DBExecutor) {
    const [challenge] = await tx
      .select()
      .from(otpChallenge)
      .where(eq(otpChallenge.id, challengeId))
      .for('update')
      .limit(1);

    if (!challenge) throw new NotFoundException('Challenge not found');

    return challenge;
  }

  private async getChallengeUserId(challenge: OtpChallenge, tx: DBExecutor) {
    const [identity] = await tx
      .select({ userId: authIdentity.userId })
      .from(authIdentity)
      .where(eq(authIdentity.id, challenge.identityId))
      .limit(1);

    if (!identity) throw new InternalServerErrorException('identity not found');

    return identity.userId;
  }

  private async consumeLockedOtpChallenge(
    dto: { challengeId: string; code: string },
    purpose: OtpPurpose,
    challenge: OtpChallenge,
    tx: DBExecutor,
  ) {
    if (
      challenge.purpose !== purpose ||
      challenge.consumedAt ||
      challenge.expiresAt < new Date()
    ) {
      throw new GoneException('OTP has expired or already been used');
    }

    if (challenge.attempts >= 5) {
      throw new HttpException(
        'Too many OTP attempts',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await tx
      .update(otpChallenge)
      .set({ attempts: challenge.attempts + 1 })
      .where(eq(otpChallenge.id, dto.challengeId));

    const isValid = await verifyHash(dto.code, challenge.codeHash);
    if (!isValid) throw new UnauthorizedException('Invalid OTP');

    await tx
      .update(otpChallenge)
      .set({ consumedAt: new Date() })
      .where(eq(otpChallenge.id, dto.challengeId));

    return challenge;
  }

  private issueAccessToken(
    userId: string,
    sessionId: string,
  ): AccessTokenResult {
    const expiresIn = this.config.jwtAccessTTLSeconds;
    const accessToken = jwt.sign(
      { sub: userId, sid: sessionId } satisfies JwtPayload,
      this.config.jwtSecret,
      { expiresIn },
    );

    return { accessToken, expiresIn };
  }

  private async issueSession(
    userId: string,
    tx: DBExecutor,
    deviceId: string | null = null,
  ) {
    await this.assertUserCanAuthenticate(userId, tx);

    const refreshToken = randomUUID();
    const refreshExpiresIn = this.config.refreshTokenTTLSeconds;
    const [session] = await tx
      .insert(authSession)
      .values({
        tokenHash: createHash('sha256').update(refreshToken).digest('hex'),
        userId,
        deviceId,
        expiresAt: new Date(Date.now() + refreshExpiresIn * 1000),
      })
      .returning({ id: authSession.id });

    if (!session) {
      throw new InternalServerErrorException('failed to create session');
    }

    const { accessToken, expiresIn: accessExpiresIn } = this.issueAccessToken(
      userId,
      session.id,
    );

    return { accessToken, accessExpiresIn, refreshToken, refreshExpiresIn };
  }

  private async issueLoginSession(
    userId: string,
    input: {
      deviceId: string;
      pushToken?: string;
      platform?: 'android' | 'ios' | 'web';
    },
    tx: DBExecutor,
  ) {
    const [loginUser] = await tx
      .update(user)
      .set({ deviceId: input.deviceId })
      .where(eq(user.id, userId))
      .returning({
        id: user.id,
        firstName: user.firstName,
        middleName: user.middleName,
        lastName: user.lastName,
        roles: user.roles,
        signupIntent: user.signupIntent,
        imageKey: user.imageKey,
        phoneVerified: user.phoneVerified,
        emailVerified: user.emailVerified,
      });

    if (!loginUser) {
      throw new InternalServerErrorException('user not found after update');
    }

    if (input.pushToken && input.platform) {
      await this.notifications.registerDeviceToken(
        userId,
        {
          deviceId: input.deviceId,
          pushToken: input.pushToken,
          platform: input.platform,
        },
        tx,
      );
    }

    const session = await this.issueSession(userId, tx, input.deviceId);
    return {
      ...session,
      roles: loginUser.roles,
      user: {
        ...loginUser,
        image: await this.resolveProfileImageUrl(loginUser.imageKey),
      },
    };
  }

  private async sendLoginWelcomeNotification(input: {
    pushToken?: string;
    platform?: 'android' | 'ios' | 'web';
  }) {
    if (!input.pushToken || !input.platform) {
      this.logger.log(
        'login welcome push skipped: request did not include both pushToken and platform',
      );
      return;
    }

    await this.notifications
      .sendWelcomeNotification(input.pushToken)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `failed to send login welcome notification: ${message}`,
        );
      });
  }

  private async resolveProfileImageUrl(
    imageKey: string | null,
  ): Promise<string | null> {
    if (!imageKey) return null;
    return this.storage.getDownloadUrl(imageKey);
  }

  private async issueAdminSession(userId: string, tx: DBExecutor) {
    await this.assertUserCanAuthenticate(userId, tx);

    const sessionToken = randomUUID();
    const sessionExpiresIn = this.config.refreshTokenTTLSeconds;
    await tx.insert(authSession).values({
      tokenHash: createHash('sha256').update(sessionToken).digest('hex'),
      userId,
      expiresAt: new Date(Date.now() + sessionExpiresIn * 1000),
    });
    return { sessionToken, sessionExpiresIn };
  }

  private async assertUserCanAuthenticate(userId: string, tx: DBExecutor) {
    const [activeUser] = await tx
      .select({ id: user.id })
      .from(user)
      .where(
        and(
          eq(user.id, userId),
          eq(user.isActive, true),
          isNull(user.deletedAt),
        ),
      )
      .for('update')
      .limit(1);

    if (!activeUser) throw new UnauthorizedException('invalid credentials');
  }

  async passwordResetStart(dto: PasswordResetStartDto) {
    const identity = await this.findVerifiedIdentity(dto.email, 'email');

    if (!identity) throw new NotFoundException('email not found');

    await this.ensureNoActiveOtpChallenge(
      dto.email,
      'email',
      'password_reset',
      this.db,
    );

    return this.issueOtpChallenge(
      {
        destination: dto.email,
        channel: 'email',
        identityId: identity.id,
        purpose: 'password_reset',
      },
      this.db,
    );
  }

  async passwordResetVerify(dto: PasswordResetVerifyDto) {
    return this.db.transaction(async (tx) => {
      const challenge = await this.consumeOtpChallenge(
        dto,
        'password_reset',
        tx,
      );
      const passwordHash = await hashPassword(dto.newPassword);
      await tx
        .update(authIdentity)
        .set({ passwordHash })
        .where(eq(authIdentity.id, challenge.identityId));
      return { message: 'password reset' };
    });
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const [identity] = await this.db
      .select()
      .from(authIdentity)
      .where(
        and(
          eq(authIdentity.userId, userId),
          eq(authIdentity.type, 'email'),
          isNotNull(authIdentity.verifiedAt),
        ),
      )
      .limit(1);

    if (!identity?.passwordHash)
      throw new NotFoundException('no email identity found');

    const isValid = await verifyHash(dto.oldPassword, identity.passwordHash);
    if (!isValid) throw new UnauthorizedException('invalid credentials');

    const passwordHash = await hashPassword(dto.newPassword);
    await this.db
      .update(authIdentity)
      .set({ passwordHash })
      .where(eq(authIdentity.id, identity.id));

    return { message: 'password changed' };
  }

  verifyAccessToken(token: string): JwtPayload {
    const payload = jwt.verify(token, this.config.jwtSecret);
    if (
      typeof payload !== 'object' ||
      typeof payload.sub !== 'string' ||
      typeof payload.sid !== 'string'
    ) {
      throw new JsonWebTokenError('invalid access token payload');
    }

    return { sub: payload.sub, sid: payload.sid };
  }
}

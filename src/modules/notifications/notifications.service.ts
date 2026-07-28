import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  and,
  arrayOverlaps,
  desc,
  eq,
  isNull,
  sql,
  type SQL,
} from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import { notificationsConfig } from '../../config';
import {
  DRIZZLE,
  type Database,
  type DBExecutor,
} from '../../database/database.module';
import { user, UserService } from '../user';
import type { UserRole } from '../user/schema/user.schema';
import type { NotificationCategory } from './notifications.types';
import {
  notification,
  userNotification,
  type NotificationSource,
} from './schema/notification.schema';
import {
  pushDeviceToken,
  type PushPlatform,
} from './schema/push-device-token.schema';

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

type RegisterDeviceTokenInput = {
  deviceId: string;
  pushToken: string;
  platform: PushPlatform;
};

type SendUserNotificationInput = {
  title: string;
  body: string;
  createdByUserId?: string;
};

type SendCategoryNotificationInput = SendUserNotificationInput & {
  category: NotificationCategory;
};

type ListNotificationsInput = {
  limit: number;
  offset: number;
};

type NotificationCounts = {
  sentCount: number;
  skippedCount: number;
  failedCount: number;
};

type AdminNotificationResult = NotificationCounts & {
  message: string;
  storedCount: number;
};

type NotificationHistoryItem = {
  id: string;
  title: string;
  body: string;
  category: NotificationCategory | null;
  source: NotificationSource;
  seenAt: Date | null;
  createdAt: Date;
};

type FcmAccessToken = {
  token: string;
  expiresAt: number;
};

type SendToTokenResult = {
  status: 'sent' | 'skipped';
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private cachedAccessToken?: FcmAccessToken;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(notificationsConfig.KEY)
    private readonly config: ConfigType<typeof notificationsConfig>,
    private readonly users: UserService,
  ) {}

  async registerDeviceToken(
    userId: string,
    input: RegisterDeviceTokenInput,
    tx: DBExecutor = this.db,
  ) {
    const now = new Date();

    await tx
      .insert(pushDeviceToken)
      .values({
        userId,
        deviceId: input.deviceId,
        platform: input.platform,
        token: input.pushToken,
        isActive: true,
        lastSeenAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [pushDeviceToken.userId, pushDeviceToken.deviceId],
        set: {
          platform: input.platform,
          token: input.pushToken,
          isActive: true,
          lastSeenAt: now,
          updatedAt: now,
        },
      });

    return { message: 'device token registered' };
  }

  async sendWelcomeNotification(pushToken: string) {
    const tokenHint = this.describeToken(pushToken);
    this.logger.log(`sending welcome push notification to ${tokenHint}`);

    const result = await this.sendToToken(pushToken, {
      notification: {
        title: 'Welcome back',
        body: 'Glad to have you back on Ubel.',
      },
      data: {
        type: 'welcome',
      },
    }).catch((error: unknown) => {
      this.logger.warn(
        `failed to send welcome push notification to ${tokenHint}: ${this.describeError(error)}`,
      );
    });

    if (result?.status === 'sent') {
      this.logger.log(`welcome push notification sent to ${tokenHint}`);
    }
    if (result?.status === 'skipped') {
      this.logger.warn(
        `welcome push notification skipped for ${tokenHint}: Firebase credentials are not configured`,
      );
    }
  }

  async sendTestNotification(userId: string) {
    const [deviceToken] = await this.db
      .select({ token: pushDeviceToken.token })
      .from(pushDeviceToken)
      .where(
        and(
          eq(pushDeviceToken.userId, userId),
          eq(pushDeviceToken.isActive, true),
        ),
      )
      .orderBy(
        desc(pushDeviceToken.lastSeenAt),
        desc(pushDeviceToken.updatedAt),
      )
      .limit(1);

    if (!deviceToken) {
      throw new NotFoundException('no active device token found');
    }

    const result = await this.sendToToken(deviceToken.token, {
      notification: {
        title: 'Ubel test notification',
        body: 'Browser push is working.',
      },
      data: {
        type: 'test_notification',
      },
    });

    return {
      message:
        result.status === 'sent'
          ? 'test notification sent'
          : 'test notification skipped; Firebase credentials are not configured',
    };
  }

  async listNotifications(userId: string, input: ListNotificationsInput) {
    return this.db.transaction(async (tx) => {
      const where = and(
        eq(userNotification.userId, userId),
        isNull(userNotification.deletedAt),
      );

      const rows = await tx
        .select({
          id: notification.id,
          title: notification.title,
          body: notification.body,
          category: notification.category,
          source: notification.source,
          seenAt: userNotification.seenAt,
          createdAt: notification.createdAt,
        })
        .from(userNotification)
        .innerJoin(
          notification,
          eq(userNotification.notificationId, notification.id),
        )
        .where(where)
        .orderBy(desc(userNotification.createdAt), desc(userNotification.id))
        .limit(input.limit)
        .offset(input.offset);

      const [countRow] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(userNotification)
        .where(where);

      const [unreadRow] = await tx
        .select({ unreadCount: sql<number>`count(*)::int` })
        .from(userNotification)
        .where(and(where, isNull(userNotification.seenAt)));

      return {
        items: rows,
        total: Number(countRow?.total ?? 0),
        limit: input.limit,
        offset: input.offset,
        unreadCount: Number(unreadRow?.unreadCount ?? 0),
      };
    });
  }

  async listNotificationsForAdmin(input: ListNotificationsInput) {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select({
          id: notification.id,
          title: notification.title,
          body: notification.body,
          category: notification.category,
          source: notification.source,
          createdByUserId: notification.createdByUserId,
          createdAt: notification.createdAt,
        })
        .from(notification)
        .orderBy(desc(notification.createdAt), desc(notification.id))
        .limit(input.limit)
        .offset(input.offset);

      const [countRow] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(notification);

      return {
        items: rows,
        total: Number(countRow?.total ?? 0),
        limit: input.limit,
        offset: input.offset,
      };
    });
  }

  async getNotification(
    userId: string,
    notificationId: string,
  ): Promise<NotificationHistoryItem> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          userNotificationId: userNotification.id,
          id: notification.id,
          title: notification.title,
          body: notification.body,
          category: notification.category,
          source: notification.source,
          seenAt: userNotification.seenAt,
          createdAt: notification.createdAt,
        })
        .from(userNotification)
        .innerJoin(
          notification,
          eq(userNotification.notificationId, notification.id),
        )
        .where(
          and(
            eq(userNotification.userId, userId),
            eq(userNotification.notificationId, notificationId),
            isNull(userNotification.deletedAt),
          ),
        )
        .for('update')
        .limit(1);

      if (!row) throw new NotFoundException('notification not found');

      const seenAt = row.seenAt ?? new Date();

      if (!row.seenAt) {
        await tx
          .update(userNotification)
          .set({ seenAt, updatedAt: seenAt })
          .where(eq(userNotification.id, row.userNotificationId));
      }

      return {
        id: row.id,
        title: row.title,
        body: row.body,
        category: row.category,
        source: row.source,
        seenAt,
        createdAt: row.createdAt,
      };
    });
  }

  async deleteNotification(userId: string, notificationId: string) {
    const now = new Date();
    const [deleted] = await this.db
      .update(userNotification)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(userNotification.userId, userId),
          eq(userNotification.notificationId, notificationId),
          isNull(userNotification.deletedAt),
        ),
      )
      .returning({ id: userNotification.id });

    if (!deleted) throw new NotFoundException('notification not found');

    return { message: 'notification deleted' };
  }

  async sendUserNotification(
    userId: string,
    input: SendUserNotificationInput,
  ): Promise<AdminNotificationResult> {
    const { notificationId, storedCount, deviceTokens } =
      await this.db.transaction(async (tx) => {
        const targetUser = await this.users.findById(userId, tx);
        if (!targetUser) throw new NotFoundException('user not found');

        const storedNotification = await this.storeNotificationForUsers(
          {
            title: input.title,
            body: input.body,
            source: 'admin',
            createdByUserId: input.createdByUserId,
            userIds: [userId],
          },
          tx,
        );

        const tokens = await this.listActiveTokensForUser(userId, tx);

        return { ...storedNotification, deviceTokens: tokens };
      });

    const delivery = await this.sendAdminNotificationToTokens(
      deviceTokens,
      input,
      `user ${userId}`,
      notificationId ? { notificationId } : {},
    );

    return { storedCount, ...delivery };
  }

  async sendCategoryNotification(
    input: SendCategoryNotificationInput,
  ): Promise<AdminNotificationResult> {
    const { notificationId, storedCount, deviceTokens } =
      await this.db.transaction(async (tx) => {
        const targetUsers = await tx
          .select({ id: user.id })
          .from(user)
          .where(and(...this.buildCategoryUserConditions(input.category)));

        const storedNotification = await this.storeNotificationForUsers(
          {
            title: input.title,
            body: input.body,
            category: input.category,
            source: 'admin',
            createdByUserId: input.createdByUserId,
            userIds: targetUsers.map((row) => row.id),
          },
          tx,
        );

        const tokens = await this.listActiveTokensForCategory(
          input.category,
          tx,
        );

        return { ...storedNotification, deviceTokens: tokens };
      });

    const delivery = await this.sendAdminNotificationToTokens(
      deviceTokens,
      input,
      `category ${input.category}`,
      {
        category: input.category,
        ...(notificationId ? { notificationId } : {}),
      },
    );

    return { storedCount, ...delivery };
  }

  private async listActiveTokensForUser(userId: string, tx: DBExecutor) {
    return tx
      .select({ token: pushDeviceToken.token })
      .from(pushDeviceToken)
      .where(
        and(
          eq(pushDeviceToken.userId, userId),
          eq(pushDeviceToken.isActive, true),
        ),
      )
      .orderBy(
        desc(pushDeviceToken.lastSeenAt),
        desc(pushDeviceToken.updatedAt),
      );
  }

  private async listActiveTokensForCategory(
    category: NotificationCategory,
    tx: DBExecutor,
  ) {
    return tx
      .selectDistinct({ token: pushDeviceToken.token })
      .from(pushDeviceToken)
      .innerJoin(user, eq(pushDeviceToken.userId, user.id))
      .where(
        and(
          eq(pushDeviceToken.isActive, true),
          ...this.buildCategoryUserConditions(category),
        ),
      );
  }

  private async storeNotificationForUsers(
    input: {
      title: string;
      body: string;
      category?: NotificationCategory;
      source: NotificationSource;
      createdByUserId?: string;
      userIds: string[];
    },
    tx: DBExecutor,
  ) {
    if (input.userIds.length === 0) {
      return { notificationId: undefined, storedCount: 0 };
    }

    const [createdNotification] = await tx
      .insert(notification)
      .values({
        title: input.title,
        body: input.body,
        category: input.category,
        source: input.source,
        createdByUserId: input.createdByUserId,
      })
      .returning({ id: notification.id });

    if (!createdNotification) {
      throw new InternalServerErrorException('failed to create notification');
    }

    const inboxRows = await tx
      .insert(userNotification)
      .values(
        input.userIds.map((userId) => ({
          userId,
          notificationId: createdNotification.id,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: userNotification.id });

    return {
      notificationId: createdNotification.id,
      storedCount: inboxRows.length,
    };
  }

  private async sendAdminNotificationToTokens(
    deviceTokens: Array<{ token: string }>,
    input: SendUserNotificationInput,
    targetDescription: string,
    data: Record<string, string> = {},
  ) {
    const counts = {
      sentCount: 0,
      skippedCount: 0,
      failedCount: 0,
    } satisfies NotificationCounts;

    await Promise.all(
      deviceTokens.map(async ({ token }) => {
        const tokenHint = this.describeToken(token);
        this.logger.log(
          `sending admin push notification to ${targetDescription} at ${tokenHint}`,
        );

        try {
          const result = await this.sendToToken(token, {
            notification: {
              title: input.title,
              body: input.body,
            },
            data: {
              type: 'admin_notification',
              ...data,
            },
          });

          if (result.status === 'sent') counts.sentCount += 1;
          if (result.status === 'skipped') counts.skippedCount += 1;
        } catch (error: unknown) {
          counts.failedCount += 1;
          this.logger.warn(
            `failed to send admin push notification to ${targetDescription} at ${tokenHint}: ${this.describeError(error)}`,
          );
        }
      }),
    );

    return {
      message: 'notification delivery completed',
      ...counts,
    };
  }

  private getCategoryAudience(category: NotificationCategory): {
    roles: UserRole[];
    phoneVerifiedOnly: boolean;
  } {
    switch (category) {
      case 'drivers':
        return { roles: ['driver'], phoneVerifiedOnly: false };
      case 'riders':
        return { roles: ['rider'], phoneVerifiedOnly: false };
      case 'verified_users_only':
        return { roles: ['rider', 'driver'], phoneVerifiedOnly: true };
      case 'all_users':
        return { roles: ['rider', 'driver'], phoneVerifiedOnly: false };
    }
  }

  private buildCategoryUserConditions(category: NotificationCategory): SQL[] {
    const audience = this.getCategoryAudience(category);
    const conditions: SQL[] = [
      eq(user.isActive, true),
      isNull(user.deletedAt),
      arrayOverlaps(user.roles, audience.roles),
    ];

    if (audience.phoneVerifiedOnly) {
      conditions.push(eq(user.phoneVerified, true));
    }

    return conditions;
  }

  private async sendToToken(
    token: string,
    message: {
      notification: { title: string; body: string };
      data?: Record<string, string>;
    },
  ): Promise<SendToTokenResult> {
    const firebase = this.config.firebase;
    if (!firebase) {
      this.logger.warn(
        'Firebase credentials are not configured; skipping FCM send',
      );
      return { status: 'skipped' };
    }

    this.logger.log(
      `sending FCM message to ${this.describeToken(token)} in project ${firebase.projectId}`,
    );
    const accessToken = await this.getAccessToken();
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${firebase.projectId}/messages:send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token,
            notification: message.notification,
            data: message.data,
          },
        }),
      },
    );

    if (response.ok) return { status: 'sent' };

    const body = await response.text();
    if (this.isInvalidRegistrationTokenResponse(body)) {
      await this.markTokenInactive(token);
    }

    throw new Error(`FCM returned ${response.status}: ${body}`);
  }

  private async getAccessToken() {
    if (
      this.cachedAccessToken &&
      this.cachedAccessToken.expiresAt > Date.now() + 60_000
    ) {
      return this.cachedAccessToken.token;
    }

    const firebase = this.config.firebase;
    if (!firebase) {
      throw new Error('Firebase credentials are not configured');
    }

    const now = Math.floor(Date.now() / 1000);
    const assertion = jwt.sign(
      {
        iss: firebase.clientEmail,
        scope: FCM_SCOPE,
        aud: GOOGLE_OAUTH_TOKEN_URL,
        iat: now,
        exp: now + 3600,
      },
      firebase.privateKey,
      { algorithm: 'RS256' },
    );

    const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });

    if (!response.ok) {
      throw new Error(`Google OAuth returned ${response.status}`);
    }

    const body = (await response.json()) as {
      access_token?: unknown;
      expires_in?: unknown;
    };

    if (
      typeof body.access_token !== 'string' ||
      typeof body.expires_in !== 'number'
    ) {
      throw new Error('Google OAuth returned an invalid access token response');
    }

    this.cachedAccessToken = {
      token: body.access_token,
      expiresAt: Date.now() + body.expires_in * 1000,
    };

    return this.cachedAccessToken.token;
  }

  private async markTokenInactive(token: string) {
    await this.db
      .update(pushDeviceToken)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(pushDeviceToken.token, token));
  }

  private isInvalidRegistrationTokenResponse(body: string) {
    return body.includes('UNREGISTERED') || body.includes('registration-token');
  }

  private describeError(error: unknown) {
    if (error instanceof Error) return error.message;
    return String(error);
  }

  private describeToken(token: string) {
    if (token.length <= 16) return `token(${token.length} chars)`;
    return `token(${token.slice(0, 6)}...${token.slice(-6)}, ${token.length} chars)`;
  }
}

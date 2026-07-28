import { registerAs } from '@nestjs/config';
import { env } from './env.schema';

type FirebaseMessagingConfig = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

export type NotificationsConfig = {
  firebase?: FirebaseMessagingConfig;
};

export const notificationsConfig = registerAs(
  'notifications',
  (): NotificationsConfig => {
    const e = env();

    if (
      !e.FIREBASE_PROJECT_ID ||
      !e.FIREBASE_CLIENT_EMAIL ||
      !e.FIREBASE_PRIVATE_KEY
    ) {
      return {};
    }

    return {
      firebase: {
        projectId: e.FIREBASE_PROJECT_ID,
        clientEmail: e.FIREBASE_CLIENT_EMAIL,
        privateKey: e.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
    };
  },
);

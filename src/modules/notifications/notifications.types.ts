export const notificationCategoryValues = [
  'all_users',
  'drivers',
  'riders',
  'verified_users_only',
] as const;

export type NotificationCategory = (typeof notificationCategoryValues)[number];

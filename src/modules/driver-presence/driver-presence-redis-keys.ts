export const driverPresenceRedisKeys = {
  lease: (queuePrefix: string, presenceSessionId: string) =>
    `${queuePrefix}:driver_presence:lease:${presenceSessionId}`,
  owner: (queuePrefix: string, userId: string) =>
    `${queuePrefix}:driver_presence:owner:${userId}`,
  h3Cell: (queuePrefix: string, h3Resolution: number, h3Cell: string) =>
    `${queuePrefix}:driver_presence:h3:${h3Resolution}:${h3Cell}`,
};

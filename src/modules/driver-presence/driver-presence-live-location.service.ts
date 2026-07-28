import { Injectable } from '@nestjs/common';
import { ZodError } from 'zod';
import {
  driverLocationUpdateEventSchema,
  type DriverLocationUpdateEvent,
} from './dto/driver-presence.dto';
import {
  DriverPresenceLeaseService,
  type DriverPresenceLocationUpdateAck,
} from './driver-presence-lease.service';

export type DriverPresenceSocketIdentity = {
  userId: string;
  sessionId: string;
  deviceId: string | null;
};

@Injectable()
export class DriverPresenceLiveLocationService {
  constructor(private readonly leases: DriverPresenceLeaseService) {}

  async acknowledgeLocationUpdate(
    identity: DriverPresenceSocketIdentity | undefined,
    payload: unknown,
  ): Promise<DriverPresenceLocationUpdateAck> {
    if (!identity) {
      return { status: 'rejected_unauthorized' };
    }

    let parsed: DriverLocationUpdateEvent;
    try {
      parsed = driverLocationUpdateEventSchema.parse(payload);
    } catch (error) {
      if (error instanceof ZodError) {
        return { status: 'rejected_invalid' };
      }
      throw error;
    }

    try {
      return await this.leases.acknowledgeLocationUpdate({
        userId: identity.userId,
        sessionId: identity.sessionId,
        payload: parsed,
      });
    } catch {
      return { status: 'unavailable_redis' };
    }
  }
}

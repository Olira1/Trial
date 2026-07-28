import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { map } from 'rxjs';
import type { Observable } from 'rxjs';

const COORDINATE_KEYS = new Set(['latitude', 'longitude']);

function stripCoordinates(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(stripCoordinates);
  }

  if (typeof value === 'object' && !(value instanceof Date)) {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      if (!COORDINATE_KEYS.has(key)) {
        result[key] = stripCoordinates(val);
      }
    }
    return result;
  }

  return value;
}

@Injectable()
export class DriverPresencePrivacyInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(map(stripCoordinates));
  }
}

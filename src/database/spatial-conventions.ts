import { customType } from 'drizzle-orm/pg-core';

export const DISPATCH_SPATIAL_SRID = 4326 as const;

export const DISPATCH_POINT_ORDER = ['longitude', 'latitude'] as const;

export const DISPATCH_POINT_GEOGRAPHY_TYPE = 'geography(Point,4326)' as const;

export const DISPATCH_POINT_GEOMETRY_TYPE = 'geometry(Point,4326)' as const;

export const DISPATCH_SPATIAL_INDEX_METHOD = 'gist' as const;

export type Point = { latitude: number; longitude: number };

export const geographyPoint = customType<{
  data: Point;
  driverData: string;
}>({
  dataType() {
    return 'geography(Point,4326)';
  },
  toDriver(value: Point): string {
    return `SRID=4326;POINT(${value.longitude} ${value.latitude})`;
  },
  fromDriver(value: string): Point {
    return value as unknown as Point;
  },
});

import {
  DISPATCH_POINT_GEOGRAPHY_TYPE,
  DISPATCH_POINT_GEOMETRY_TYPE,
  DISPATCH_POINT_ORDER,
  DISPATCH_SPATIAL_INDEX_METHOD,
  DISPATCH_SPATIAL_SRID,
} from './spatial-conventions';

describe('dispatch spatial database conventions', () => {
  it('defines the canonical PostGIS point contract for dispatch schemas', () => {
    expect(DISPATCH_SPATIAL_SRID).toBe(4326);
    expect(DISPATCH_POINT_ORDER).toEqual(['longitude', 'latitude']);
    expect(DISPATCH_POINT_GEOGRAPHY_TYPE).toBe('geography(Point,4326)');
    expect(DISPATCH_POINT_GEOMETRY_TYPE).toBe('geometry(Point,4326)');
    expect(DISPATCH_SPATIAL_INDEX_METHOD).toBe('gist');
  });
});

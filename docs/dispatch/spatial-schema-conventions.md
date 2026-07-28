# Dispatch Spatial Schema Conventions

**Status:** Accepted for `D1.2`

**Type:** Reference

This page defines the database-facing spatial conventions for Instant Ride dispatch. Use it when adding dispatch migrations, spatial queries, fixtures, or tests.

## Scope

These conventions apply to dispatch-owned spatial data and tests inside `UbelBackend`.

In scope:

- durable rider pickup and destination points;
- future durable service-area or boundary fields;
- exact distance predicates used by dispatch;
- PostGIS migration smoke tests;
- conversion between API coordinate fields and database points.

Out of scope:

- Redis live driver location snapshots;
- H3 resolution, ring count, and expansion policy;
- Gebeta Maps adapter coordinate formatting;
- trip-time post-assignment tracking;
- long-term location-history retention.

## Coordinate Contract

External API, Socket.IO, and provider-facing DTOs use named fields:

| Field       | Range         |
| ----------- | ------------- |
| `latitude`  | `[-90, 90]`   |
| `longitude` | `[-180, 180]` |

Database point construction uses PostGIS `x, y` order:

```sql
ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
```

Rules:

- Never store or accept ambiguous coordinate arrays in dispatch contracts.
- Treat `ST_X(point::geometry)` as longitude.
- Treat `ST_Y(point::geometry)` as latitude.
- Use deterministic Addis Ababa fixtures in spatial tests.
- Do not log precise coordinates in application logs, errors, or metrics.

## SRID

All dispatch PostGIS point columns must use SRID `4326`.

Allowed type names:

| Constant                        | SQL type                | Use                                                                 |
| ------------------------------- | ----------------------- | ------------------------------------------------------------------- |
| `DISPATCH_POINT_GEOGRAPHY_TYPE` | `geography(Point,4326)` | Durable point fields used with meter-based distance/radius queries. |
| `DISPATCH_POINT_GEOMETRY_TYPE`  | `geometry(Point,4326)`  | Planar/topological fields with an approved task-level reason.       |
| `DISPATCH_SPATIAL_INDEX_METHOD` | `gist`                  | Spatial indexes for dispatch point predicates.                      |
| `DISPATCH_SPATIAL_SRID`         | `4326`                  | Required SRID for dispatch point columns and fixtures.              |
| `DISPATCH_POINT_ORDER`          | `longitude, latitude`   | Database point construction and `ST_X`/`ST_Y` interpretation.       |

The executable constants live in `src/database/spatial-conventions.ts`.

## Geography Versus Geometry

Use `geography(Point,4326)` for durable rider pickup and destination points. Dispatch V1 distance policies are meter-based and use Earth coordinates, so geography is the safe default for exact distance checks.

Use `geometry(Point,4326)` only when the task explicitly needs geometry semantics, such as planar topology, service-area geometry, or another PostGIS operation that is not suitable for geography. The task approval brief must state why `geography(Point,4326)` is not the right type.

Do not persist pre-assignment driver live coordinates in PostgreSQL for V1. Redis owns live presence and H3 indexing; PostgreSQL/PostGIS owns durable spatial truth. A Redis outage must fail closed for matching rather than falling back to durable driver coordinate history.

H3 storage details are deferred until the Redis/H3 and candidate-policy tasks. Do not introduce a durable H3 column as part of a spatial table unless the active task approves it.

## Index And Query Compatibility

Any migration adding a dispatch spatial column must document the query pattern that the index exists to support.

Required rules:

- Use GiST indexes for `geography(Point,4326)` columns used with `ST_DWithin`, exact radius filters, or distance ordering.
- Use GiST indexes for `geometry(Point,4326)` columns used with geometry spatial predicates such as `ST_DWithin`, `ST_Intersects`, or containment checks.
- Keep the indexed expression and query expression compatible. Do not index `geography` and query an unindexed `geometry` cast unless the task explicitly proves the plan remains acceptable.
- Avoid brittle `EXPLAIN` assertions until the real query exists. For early migration smoke tests, assert the declared index method, column type, SRID, point order, and predicate truth table.
- Revisit query-plan assertions when real candidate filtering queries are introduced.

## Migration Smoke Tests

Every migration that adds a dispatch spatial column must include a database-backed smoke test that proves:

- the migration applies cleanly against PostGIS;
- the column has the approved PostGIS type and SRID;
- inserting a point through `ST_MakePoint(longitude, latitude)` stores the expected `ST_X` and `ST_Y`;
- the intended spatial predicate returns true for a near Addis fixture and false for a far fixture;
- the intended spatial index exists with the approved method;
- test writes run in a transaction or temporary table and leave no durable residue.

`src/database/spatial-conventions.integration.spec.ts` is the baseline convention smoke test. Real schema migrations should add tests closer to the module that owns the table.

## ORM Constraint

Drizzle's current PostGIS helper is not the source of truth for dispatch spatial schema. In this codebase version, the helper does not provide a geography column helper and must not be allowed to weaken the approved SQL type or SRID requirement.

If Drizzle cannot express the exact approved spatial type, use explicit SQL migrations and, where needed, a narrow custom type wrapper. The database schema and smoke tests are authoritative.

## Review Checklist

Before approving a task that adds or queries dispatch spatial data:

- [ ] External contracts use named `latitude` and `longitude` fields.
- [ ] Database construction uses `ST_MakePoint(longitude, latitude)`.
- [ ] The column uses SRID `4326`.
- [ ] `geography(Point,4326)` is used unless geometry is explicitly justified.
- [ ] A compatible GiST index exists for the approved query.
- [ ] Tests prove SRID, point order, type, index method, and predicate behavior.
- [ ] No pre-assignment driver coordinate history is persisted.
- [ ] Logs, metrics, and errors do not include precise coordinates.

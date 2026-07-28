# Gebeta Maps Capability Spike

**Task:** `D0.3`

**Last verified:** 2026-06-11

**Status:** Engineering contract approved; production-provider approval remains blocked on written vendor answers.

## Purpose

This document records the observed Gebeta Maps routing contract and the V1 dispatch integration policy derived from it. It is not a substitute for a commercial agreement, SLA, DPA, or vendor-owned API specification.

The live spike used a disposable development key and made 188 authenticated requests, below the approved 200-call limit. AWS Milan latency measurement was explicitly deferred.

## Sources And Confidence

| Source                 | Use                                                                 | Confidence                                                                    |
| ---------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Official public docs   | Advertised endpoints, parameters, response codes, and limits        | Low where contradicted by live behavior or where response examples are absent |
| Controlled live probes | Observed authentication, request formats, response shapes, failures | Medium; behavior is unversioned and not yet contractually confirmed           |
| Written vendor answers | Commercial, operational, privacy, and stable-contract confirmation  | Pending                                                                       |

Public documentation reviewed:

- [Direction API](https://docs.gebeta.app/docs/direction)
- [Matrix API](https://docs.gebeta.app/docs/matrix)
- [ONM API](https://docs.gebeta.app/docs/onm)
- [Pricing](https://gebeta.app/pricing)
- [Terms](https://gebeta.app/terms)
- [Privacy](https://gebeta.app/privacy)

## Verified Live Behavior

### Authentication

- `Authorization: Bearer <key>` works and is the approved backend authentication mechanism.
- Query-string `apiKey` works but is prohibited for production because URLs commonly reach proxy, trace, and access logs.
- `x-api-key` and a raw, non-Bearer `Authorization` value did not authenticate.
- Missing and invalid credentials returned `401` JSON responses.
- The key must never be logged, included in metrics dimensions, or sent to clients.

### Coordinates And Units

- Accepted request coordinate order is `latitude,longitude`.
- Direction geometry is returned as `[latitude, longitude]`.
- Direction `totalDistance` appears to be meters.
- Direction `timetaken` appears to be seconds.
- Matrix and ONM `distance` appear to be kilometers.
- Matrix and ONM `time` appear to be seconds.
- Unit interpretation remains a production blocker until confirmed in writing.

### Direction API

Observed successful response fields:

- `msg`
- `timetaken`
- `totalDistance`
- `direction`

Observed problems:

- Some apparently valid Addis Ababa routes returned opaque `500` responses.
- Unreachable routes returned opaque `500` rather than documented `404 NoRoute`.
- Direction and Matrix returned materially different distance and duration values for the same route.
- Waypoint documentation and accepted live formats are inconsistent.

Direction is not required for V1 candidate ranking. A future trip-navigation or offer-display use must complete a separate approval task.

### Matrix API

Observed successful response fields:

- `origins`
- `destinations`
- `origin_to_destination`

`origin_to_destination` contains all-pairs entries shaped as:

```text
{ from: integer, to: integer, distance: number, time: number }
```

Observed problems:

- The documentation says at most 10 coordinates, but live requests accepted 20.
- For `N` requested coordinates, live responses returned `N` origins, `N + 1` destinations, and `N²` route pairs. The final destination metadata entry was duplicated.
- Undocumented `sources` and `destinations` query parameters were silently ignored.
- One unreachable coordinate caused the entire request to return an opaque `500`.
- Malformed requests sometimes returned opaque `500` responses.

Only `origin_to_destination` is usable as the V1 route-estimate source. Metadata arrays must not be trusted to prove cardinality.

### ONM API

ONM is one-origin-to-many-destinations, while dispatch needs many-driver-origins-to-one-pickup.

Observed problems:

- Reversing the route would be incorrect because road travel is directional.
- Some documented-looking malformed formats returned `200 null`.
- A request containing one valid and one unreachable destination returned `200 null`, losing the valid result.

ONM is prohibited for V1 dispatch candidate ranking.

### Errors And Limits

- Validation errors can return structured `422` responses with code `HE00008`.
- Malformed or unreachable requests can also return opaque `500` responses with empty error fields.
- No request ID, rate-limit headers, or `Retry-After` header was observed.
- A burst of 60 valid Matrix requests completed successfully but produced severe queueing.
- A burst of 70 invalid requests returned `422`; the documented 50-request-per-second limit was not observably enforced.
- Absence of observed throttling is not permission to exceed documented limits.

## Observed Latency

Measurements are from the development environment, not AWS Milan:

| Probe                          | Result                                   |
| ------------------------------ | ---------------------------------------- |
| Repeated two-coordinate Matrix | 133-181 ms                               |
| Repeated Direction             | 276-563 ms                               |
| 60 concurrent Matrix requests  | p50 1,968 ms; p95 2,589 ms; max 2,625 ms |

The concurrency result shows provider-side or network queueing under burst load. Dispatch must bound concurrency and measure production behavior before rollout.

## Approved V1 Dispatch Integration Contract

### Provider Interface

The application-owned routing interface accepts candidate driver origins and one pickup destination. It returns one explicit outcome per candidate:

- routed estimate with integer distance meters and duration seconds;
- unreachable;
- unavailable because the provider batch failed or returned an invalid contract.

Provider-specific fields never leave `RoutingModule`.

### Batching

- Use Matrix only for V1 candidate ranking.
- Enforce the documented limit ourselves: at most 10 total coordinates per request.
- Each batch therefore contains at most 9 candidate origins plus the pickup.
- Extract only candidate-to-pickup pairs from the returned all-pairs matrix.
- Never assume request or response ordering without validating `from` and `to` indexes.
- Require exactly `N²` unique, in-range route-pair entries before trusting a batch.
- Reject negative, non-finite, fractional-index, duplicate-index, or missing values.
- Convert Matrix kilometers to integer meters at the adapter boundary.

### Timeout, Retry, And Concurrency

- Initial provider timeout: configurable 3,000 ms.
- The adapter performs no automatic retry.
- Dispatch orchestration owns retry/defer decisions within the total matching deadline.
- Provider calls occur outside database transactions.
- Concurrency must be bounded; an exact initial limit is decided during `D4.5` using integration measurements.

### Failure Policy

- No synthetic city-grid, straight-line, or silently degraded route estimate is allowed.
- A failed batch does not silently remove or mis-rank its candidates.
- A provider failure is not `no_driver_found`.
- Routing exhaustion ends with a distinct internal/system failure outcome and rider-safe messaging.
- Per-candidate unreachable results may exclude only those candidates when the provider contract explicitly identifies them.
- Opaque `500`, timeout, `200 null`, malformed shape, incomplete matrix, and invalid units are provider failures.

### Caching

- No cross-request route-estimate caching in V1.
- Provider HTTP caching behavior must not be assumed.
- Re-evaluate short-lived caching only after correctness, traffic behavior, freshness, and pricing are understood.

### Secrets

- Use Bearer authentication from a secret manager/configuration boundary.
- Never place credentials in URLs, source control, logs, traces, metrics, or client payloads.
- Support a controlled key replacement deployment.
- Zero-downtime multiple-active-key rotation remains blocked on vendor confirmation.

## Production Go-Live Blockers

Written vendor confirmation is required for:

- Direction and Matrix distance/time units.
- Explanation of Direction versus Matrix differences for the same route.
- Stable Matrix response schema, including the duplicated destination metadata.
- Contractual coordinate and element limits.
- Supported many-to-one or Matrix subset capability.
- Unreachable and partial-route behavior.
- `429`, `5xx`, retry, and `Retry-After` behavior.
- Official support for Bearer authentication.
- Multiple active keys and zero-downtime rotation.
- Pricing per request and per Matrix element.
- SLA, support response targets, API versioning, and deprecation policy.
- Location/request retention, data residency, deletion, subprocessors, and DPA terms.
- Traffic-data source, refresh interval, and affected APIs.

Until these are resolved, Gebeta may be used in controlled development/integration environments but is not approved as the production routing dependency.

## Downstream Requirements

- `D4.4` defines explicit provider-failure and unreachable outcomes before any Gebeta adapter exists.
- `D4.5` uses contract fixtures captured from reviewed, non-secret response shapes and tests every observed failure.
- `D4.7` measures provider latency, batch size, queueing, timeout, malformed responses, and failure outcomes.
- Rollout requires a provider kill switch, bounded concurrency, production-region measurements, and an approved operational escalation path.

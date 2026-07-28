# Phase 7 - Socket.IO Realtime Delivery

## Goal

Deliver authenticated live dispatch state while preserving PostgreSQL as durable truth.

## Tasks

### `D7.1` Event Contracts and Authentication

- [x] Define rider/driver event names, payloads, versions, and authorization.
- [x] Define connection authentication and token/session refresh.
- [x] Define reconnect snapshot behavior.

### `D7.2` Gateway and Rooms

- [x] Authenticate every connection.
- [x] Join only authorized user/request/offer rooms.
- [x] Test unauthorized subscriptions and disconnect cleanup.

### `D7.3` Durable Event Publication

- [x] Publish committed outbox events to Socket.IO.
- [x] Make duplicate delivery acceptable/idempotent for clients.
- [x] Never emit an event for a rolled-back state transition.

### `D7.4` Reconnect and Snapshot

- [x] Client reconnect obtains current durable state rather than relying on replay alone.
- [x] Test missed events, duplicate events, and stale client state.

### `D7.5` Multi-Instance Delivery

- [x] Configure approved Socket.IO scaling adapter/backplane.
- [x] Prove events reach clients connected to different API instances.

## Exit Gate

Authenticated clients receive timely events and recover correct state after disconnects, duplicates, and instance changes.

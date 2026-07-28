// Barrel for all module schemas. Each module exports its tables/enums via
// its own `schema/` folder; re-export them here so drizzle-kit can discover
// them for migration generation.
export * from '../modules/user/schema/user.schema';
export * from '../modules/driver/schema';
export * from '../modules/driver-presence/schema';
export * from '../modules/support/schema';
export * from '../modules/rewards/schema';
export * from '../modules/notifications/schema';
export * from '../modules/ad-banners/schema';
export * from '../modules/dispatch-outbox/schema';
export * from '../modules/auth/schema/auth-identity.schema';
export * from '../modules/auth/schema/auth-identity-history.schema';
export * from '../modules/auth/schema/otp-challenge.schema';
export * from '../modules/auth/schema/passkey-credential.schema';
export * from '../modules/auth/schema/session.schema';
export * from '../modules/ride-requests/schema';
export * from '../modules/dispatch-offer/schema';
export * from '../modules/fare-estimates/schema';

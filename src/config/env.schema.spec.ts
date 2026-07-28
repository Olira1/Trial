import { validateEnv } from './env.schema';

describe('validateEnv', () => {
  const minimal = {
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    REDIS_PASSWORD: 'test-password',
    S3_BUCKET: 'test-bucket',
    S3_REGION: 'us-east-1',
    JWT_SECRET: 'a-secret-that-is-at-least-32-characters-long',
  };

  it('accepts a minimal env and applies defaults', () => {
    const env = validateEnv(minimal);
    expect(env.NODE_ENV).toBe('production');
    expect(env.PORT).toBe(3000);
    expect(env.REDIS_HOST).toBe('localhost');
    expect(env.REDIS_PORT).toBe(6379);
    expect(env.JWT_ACCESS_TTL_SECONDS).toBe(900);
    expect(env.OTP_RESEND_COOLDOWN_SECONDS).toBe(60);
    expect(env.S3_BUCKET).toBe('test-bucket');
    expect(env.S3_FORCE_PATH_STYLE).toBe(false);
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it('throws when DATABASE_URL is not a URL', () => {
    expect(() => validateEnv({ DATABASE_URL: 'not-a-url' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('throws when JWT_SECRET is too short', () => {
    expect(() => validateEnv({ ...minimal, JWT_SECRET: 'short' })).toThrow(
      /JWT_SECRET/,
    );
  });

  it('coerces numeric strings to numbers', () => {
    const env = validateEnv({
      ...minimal,
      PORT: '4000',
      JWT_ACCESS_TTL_SECONDS: '300',
      OTP_RESEND_COOLDOWN_SECONDS: '30',
    });
    expect(env.PORT).toBe(4000);
    expect(env.JWT_ACCESS_TTL_SECONDS).toBe(300);
    expect(env.OTP_RESEND_COOLDOWN_SECONDS).toBe(30);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => validateEnv({ ...minimal, NODE_ENV: 'staging' })).toThrow(
      /NODE_ENV/,
    );
  });

  it('rejects a non-positive PORT', () => {
    expect(() => validateEnv({ ...minimal, PORT: '0' })).toThrow(/PORT/);
    expect(() => validateEnv({ ...minimal, PORT: '-1' })).toThrow(/PORT/);
  });

  it('aggregates multiple errors into a single message', () => {
    expect(() =>
      validateEnv({ DATABASE_URL: 'bad', NODE_ENV: 'staging' }),
    ).toThrow(/DATABASE_URL[\s\S]*NODE_ENV|NODE_ENV[\s\S]*DATABASE_URL/);
  });

  it('throws when S3_BUCKET is missing', () => {
    const { S3_BUCKET: _S3_BUCKET, ...withoutBucket } = minimal;
    expect(() => validateEnv(withoutBucket)).toThrow(/S3_BUCKET/);
  });

  it('parses S3_FORCE_PATH_STYLE correctly', () => {
    expect(
      validateEnv({ ...minimal, S3_FORCE_PATH_STYLE: 'true' })
        .S3_FORCE_PATH_STYLE,
    ).toBe(true);
    expect(
      validateEnv({ ...minimal, S3_FORCE_PATH_STYLE: 'false' })
        .S3_FORCE_PATH_STYLE,
    ).toBe(false);
    expect(validateEnv(minimal).S3_FORCE_PATH_STYLE).toBe(false);
  });

  it('accepts Firebase notification credentials when configured together', () => {
    const env = validateEnv({
      ...minimal,
      FIREBASE_PROJECT_ID: 'ubel-test',
      FIREBASE_CLIENT_EMAIL: 'firebase-adminsdk@test.iam.gserviceaccount.com',
      FIREBASE_PRIVATE_KEY:
        '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n',
    });

    expect(env.FIREBASE_PROJECT_ID).toBe('ubel-test');
    expect(env.FIREBASE_CLIENT_EMAIL).toBe(
      'firebase-adminsdk@test.iam.gserviceaccount.com',
    );
  });

  it('rejects partial Firebase notification credentials', () => {
    expect(() =>
      validateEnv({ ...minimal, FIREBASE_PROJECT_ID: 'ubel-test' }),
    ).toThrow(/FIREBASE_PROJECT_ID/);
  });
});

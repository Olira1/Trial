import { registerAs } from '@nestjs/config';
import { env } from './env.schema';

type AuthConfig = {
  refreshTokenTTLSeconds: number;
  jwtAccessTTLSeconds: number;
  cookieSessionTTLSeconds: number;
  otpTtlSeconds: number;
  otpResendCooldownSeconds: number;
  jwtSecret: string;
};

export const authConfig = registerAs('auth', (): AuthConfig => {
  const e = env();
  return {
    refreshTokenTTLSeconds: e.REFRESH_TOKEN_TTL_SECONDS,
    jwtAccessTTLSeconds: e.JWT_ACCESS_TTL_SECONDS,
    cookieSessionTTLSeconds: e.COOKIE_SESSION_TTL_SECONDS,
    otpTtlSeconds: e.OTP_TTL_SECONDS,
    otpResendCooldownSeconds: e.OTP_RESEND_COOLDOWN_SECONDS,
    jwtSecret: e.JWT_SECRET,
  };
});

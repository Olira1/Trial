CREATE TYPE "public"."otp_purpose" AS ENUM('sign_up', 'login', 'connect_email', 'admin_login', 'password_reset');--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "roles" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "otp_challenge" ADD COLUMN "purpose" "otp_purpose";--> statement-breakpoint
UPDATE "otp_challenge" SET "consumed_at" = now() WHERE "purpose" IS NULL AND "consumed_at" IS NULL;

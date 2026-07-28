CREATE TYPE "public"."user_signup_intent" AS ENUM('rider', 'driver');--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "signup_intent" "user_signup_intent";--> statement-breakpoint
UPDATE "user"
SET "signup_intent" = CASE
	WHEN 'driver'::"user_role" = ANY("roles") THEN 'driver'::"user_signup_intent"
	WHEN 'rider'::"user_role" = ANY("roles") THEN 'rider'::"user_signup_intent"
	ELSE NULL
END;

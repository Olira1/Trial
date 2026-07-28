CREATE TYPE "public"."driver_operational_state" AS ENUM('offline', 'online', 'offered', 'assigned', 'suspended');--> statement-breakpoint
CREATE TABLE "driver_operational_profile" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"operational_state" "driver_operational_state" DEFAULT 'offline' NOT NULL,
	"owner_session_id" uuid,
	"presence_session_id" text,
	"presence_generation" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_operational_profile_ck_generation_nonnegative" CHECK ("driver_operational_profile"."presence_generation" >= 0),
	CONSTRAINT "driver_operational_profile_ck_presence_authority" CHECK ((
        (
          "driver_operational_profile"."operational_state" IN ('online', 'offered', 'assigned')
          AND "driver_operational_profile"."owner_session_id" IS NOT NULL
          AND NULLIF(BTRIM("driver_operational_profile"."presence_session_id"), '') IS NOT NULL
          AND "driver_operational_profile"."presence_generation" > 0
        )
        OR
        (
          "driver_operational_profile"."operational_state" IN ('offline', 'suspended')
          AND "driver_operational_profile"."owner_session_id" IS NULL
          AND "driver_operational_profile"."presence_session_id" IS NULL
        )
      ))
);
--> statement-breakpoint
ALTER TABLE "driver_operational_profile" ADD CONSTRAINT "driver_operational_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_operational_profile" ADD CONSTRAINT "driver_operational_profile_owner_session_id_auth_session_id_fk" FOREIGN KEY ("owner_session_id") REFERENCES "public"."auth_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "driver_operational_profile_uq_user_id" ON "driver_operational_profile" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "driver_operational_profile_uq_presence_session_id" ON "driver_operational_profile" USING btree ("presence_session_id") WHERE "driver_operational_profile"."presence_session_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "driver_operational_profile_ix_operational_state" ON "driver_operational_profile" USING btree ("operational_state");--> statement-breakpoint
CREATE INDEX "driver_operational_profile_ix_owner_session_id" ON "driver_operational_profile" USING btree ("owner_session_id");
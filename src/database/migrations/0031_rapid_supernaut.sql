CREATE TYPE "public"."dispatch_attempt_state" AS ENUM('in_progress', 'completed', 'failed', 'exhausted');--> statement-breakpoint
CREATE TYPE "public"."dispatch_offer_state" AS ENUM('pending', 'accepted', 'rejected', 'expired', 'cancelled');--> statement-breakpoint
CREATE TABLE "dispatch_attempt" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"request_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"state" "dispatch_attempt_state" DEFAULT 'in_progress' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispatch_attempt_ck_attempt_number_positive" CHECK ("dispatch_attempt"."attempt_number" > 0),
	CONSTRAINT "dispatch_attempt_ck_finished_after_started" CHECK ("dispatch_attempt"."finished_at" IS NULL OR "dispatch_attempt"."finished_at" >= "dispatch_attempt"."started_at")
);
--> statement-breakpoint
CREATE TABLE "dispatch_offer" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"request_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"state" "dispatch_offer_state" DEFAULT 'pending' NOT NULL,
	"offered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"eta_seconds" integer,
	"distance_meters" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispatch_offer_ck_expires_after_offered" CHECK ("dispatch_offer"."expires_at" > "dispatch_offer"."offered_at"),
	CONSTRAINT "dispatch_offer_ck_eta_positive" CHECK ("dispatch_offer"."eta_seconds" IS NULL OR "dispatch_offer"."eta_seconds" > 0),
	CONSTRAINT "dispatch_offer_ck_distance_positive" CHECK ("dispatch_offer"."distance_meters" IS NULL OR "dispatch_offer"."distance_meters" > 0)
);
--> statement-breakpoint
ALTER TABLE "dispatch_attempt" ADD CONSTRAINT "dispatch_attempt_request_id_ride_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."ride_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_offer" ADD CONSTRAINT "dispatch_offer_request_id_ride_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."ride_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_offer" ADD CONSTRAINT "dispatch_offer_attempt_id_dispatch_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."dispatch_attempt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_offer" ADD CONSTRAINT "dispatch_offer_driver_id_user_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dispatch_attempt_uq_request_attempt_number" ON "dispatch_attempt" USING btree ("request_id","attempt_number");--> statement-breakpoint
CREATE INDEX "dispatch_attempt_ix_request_id" ON "dispatch_attempt" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "dispatch_attempt_ix_state" ON "dispatch_attempt" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "dispatch_offer_uq_request_pending" ON "dispatch_offer" USING btree ("request_id") WHERE "dispatch_offer"."state" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "dispatch_offer_uq_driver_pending" ON "dispatch_offer" USING btree ("driver_id") WHERE "dispatch_offer"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "dispatch_offer_ix_request_id" ON "dispatch_offer" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "dispatch_offer_ix_driver_id" ON "dispatch_offer" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "dispatch_offer_ix_state" ON "dispatch_offer" USING btree ("state");
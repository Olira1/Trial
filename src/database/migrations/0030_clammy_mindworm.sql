CREATE TYPE "public"."ride_request_state" AS ENUM('searching', 'offered', 'assigned', 'cancelled', 'expired', 'no_driver_found', 'system_failed');--> statement-breakpoint
CREATE TABLE "ride_request" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"rider_id" uuid NOT NULL,
	"state" "ride_request_state" DEFAULT 'searching' NOT NULL,
	"pickup" geography(Point,4326) NOT NULL,
	"destination" geography(Point,4326) NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"offer_ttl_seconds" integer NOT NULL,
	"matching_deadline_seconds" integer NOT NULL,
	"matching_deadline_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ride_request_ck_offer_ttl_valid" CHECK ("ride_request"."offer_ttl_seconds" > 0),
	CONSTRAINT "ride_request_ck_matching_deadline_future" CHECK ("ride_request"."matching_deadline_at" > "ride_request"."created_at")
);
--> statement-breakpoint
ALTER TABLE "ride_request" ADD CONSTRAINT "ride_request_rider_id_user_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ride_request_uq_rider_idempotency" ON "ride_request" USING btree ("rider_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "ride_request_ix_state" ON "ride_request" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "ride_request_uq_active_rider" ON "ride_request" USING btree ("rider_id") WHERE "ride_request"."state" IN ('searching', 'offered');
CREATE TYPE "public"."dispatch_assignment_trip_state" AS ENUM('started', 'completed');--> statement-breakpoint
ALTER TYPE "public"."ride_request_state" ADD VALUE 'completed' BEFORE 'cancelled';--> statement-breakpoint
CREATE TABLE "dispatch_assignment_trip" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"rider_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"state" "dispatch_assignment_trip_state" DEFAULT 'started' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispatch_assignment_trip_ck_completed_at" CHECK (("dispatch_assignment_trip"."state" = 'completed' AND "dispatch_assignment_trip"."completed_at" IS NOT NULL AND "dispatch_assignment_trip"."completed_at" >= "dispatch_assignment_trip"."started_at") OR ("dispatch_assignment_trip"."state" = 'started' AND "dispatch_assignment_trip"."completed_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "dispatch_assignment_trip" ADD CONSTRAINT "dispatch_assignment_trip_assignment_id_dispatch_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."dispatch_assignment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_assignment_trip" ADD CONSTRAINT "dispatch_assignment_trip_request_id_ride_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."ride_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_assignment_trip" ADD CONSTRAINT "dispatch_assignment_trip_offer_id_dispatch_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."dispatch_offer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_assignment_trip" ADD CONSTRAINT "dispatch_assignment_trip_rider_id_user_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_assignment_trip" ADD CONSTRAINT "dispatch_assignment_trip_driver_id_user_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dispatch_assignment_trip_uq_assignment" ON "dispatch_assignment_trip" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "dispatch_assignment_trip_ix_request" ON "dispatch_assignment_trip" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "dispatch_assignment_trip_ix_driver" ON "dispatch_assignment_trip" USING btree ("driver_id");

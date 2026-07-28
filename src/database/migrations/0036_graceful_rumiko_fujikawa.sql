CREATE TYPE "public"."dispatch_cancellation_actor_role" AS ENUM('rider', 'driver', 'system');--> statement-breakpoint
CREATE TYPE "public"."dispatch_cancellation_reason" AS ENUM('generic', 'wrong_pickup', 'rider_changed_mind', 'driver_delay', 'driver_requested', 'driver_emergency', 'driver_no_show', 'rider_no_show', 'other');--> statement-breakpoint
CREATE TABLE "dispatch_cancellation" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"request_id" uuid NOT NULL,
	"offer_id" uuid,
	"assignment_id" uuid,
	"actor_user_id" uuid NOT NULL,
	"actor_role" "dispatch_cancellation_actor_role" NOT NULL,
	"reason_code" "dispatch_cancellation_reason" DEFAULT 'generic' NOT NULL,
	"notes" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispatch_cancellation_ck_notes_nonempty" CHECK ("dispatch_cancellation"."notes" IS NULL OR NULLIF(BTRIM("dispatch_cancellation"."notes"), '') IS NOT NULL),
	CONSTRAINT "dispatch_cancellation_ck_assignment_requires_offer" CHECK ("dispatch_cancellation"."assignment_id" IS NULL OR "dispatch_cancellation"."offer_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "dispatch_cancellation" ADD CONSTRAINT "dispatch_cancellation_request_id_ride_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."ride_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_cancellation" ADD CONSTRAINT "dispatch_cancellation_offer_id_dispatch_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."dispatch_offer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_cancellation" ADD CONSTRAINT "dispatch_cancellation_assignment_id_dispatch_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."dispatch_assignment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_cancellation" ADD CONSTRAINT "dispatch_cancellation_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dispatch_cancellation_uq_request" ON "dispatch_cancellation" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "dispatch_cancellation_ix_actor" ON "dispatch_cancellation" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "dispatch_cancellation_ix_assignment" ON "dispatch_cancellation" USING btree ("assignment_id");
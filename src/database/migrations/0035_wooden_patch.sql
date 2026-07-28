CREATE TYPE "public"."dispatch_assignment_pickup_state" AS ENUM('arrived', 'warning_sent', 'rider_no_show_cancelled');--> statement-breakpoint
CREATE TABLE "dispatch_assignment_pickup" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"rider_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"state" "dispatch_assignment_pickup_state" DEFAULT 'arrived' NOT NULL,
	"arrived_at" timestamp with time zone NOT NULL,
	"warning_due_at" timestamp with time zone NOT NULL,
	"warning_sent_at" timestamp with time zone,
	"no_show_cancellable_at" timestamp with time zone NOT NULL,
	"no_show_cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispatch_assignment_pickup_ck_warning_due_after_arrival" CHECK ("dispatch_assignment_pickup"."warning_due_at" >= "dispatch_assignment_pickup"."arrived_at"),
	CONSTRAINT "dispatch_assignment_pickup_ck_no_show_due_after_arrival" CHECK ("dispatch_assignment_pickup"."no_show_cancellable_at" >= "dispatch_assignment_pickup"."arrived_at"),
	CONSTRAINT "dispatch_assignment_pickup_ck_warning_sent_after_arrival" CHECK ("dispatch_assignment_pickup"."warning_sent_at" IS NULL OR "dispatch_assignment_pickup"."warning_sent_at" >= "dispatch_assignment_pickup"."arrived_at"),
	CONSTRAINT "dispatch_assignment_pickup_ck_no_show_cancelled_after_arrival" CHECK ("dispatch_assignment_pickup"."no_show_cancelled_at" IS NULL OR "dispatch_assignment_pickup"."no_show_cancelled_at" >= "dispatch_assignment_pickup"."arrived_at")
);
--> statement-breakpoint
ALTER TABLE "dispatch_assignment_pickup" ADD CONSTRAINT "dispatch_assignment_pickup_assignment_id_dispatch_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."dispatch_assignment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_assignment_pickup" ADD CONSTRAINT "dispatch_assignment_pickup_request_id_ride_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."ride_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_assignment_pickup" ADD CONSTRAINT "dispatch_assignment_pickup_offer_id_dispatch_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."dispatch_offer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_assignment_pickup" ADD CONSTRAINT "dispatch_assignment_pickup_rider_id_user_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_assignment_pickup" ADD CONSTRAINT "dispatch_assignment_pickup_driver_id_user_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dispatch_assignment_pickup_uq_assignment" ON "dispatch_assignment_pickup" USING btree ("assignment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dispatch_assignment_pickup_uq_request" ON "dispatch_assignment_pickup" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dispatch_assignment_pickup_uq_offer" ON "dispatch_assignment_pickup" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "dispatch_assignment_pickup_ix_driver_state" ON "dispatch_assignment_pickup" USING btree ("driver_id","state");--> statement-breakpoint
CREATE INDEX "dispatch_assignment_pickup_ix_warning_due" ON "dispatch_assignment_pickup" USING btree ("warning_sent_at","warning_due_at");--> statement-breakpoint
CREATE INDEX "dispatch_assignment_pickup_ix_no_show_due" ON "dispatch_assignment_pickup" USING btree ("no_show_cancelled_at","no_show_cancellable_at");
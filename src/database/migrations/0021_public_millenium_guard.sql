CREATE TYPE "public"."driver_compliance_event_action" AS ENUM('suspended', 'reinstated');--> statement-breakpoint
CREATE TABLE "driver_compliance_event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" "driver_compliance_event_action" NOT NULL,
	"reason" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "driver_compliance_event" ADD CONSTRAINT "driver_compliance_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_compliance_event" ADD CONSTRAINT "driver_compliance_event_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "driver_compliance_event_ix_user" ON "driver_compliance_event" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "driver_compliance_event_ix_action" ON "driver_compliance_event" USING btree ("action","occurred_at");
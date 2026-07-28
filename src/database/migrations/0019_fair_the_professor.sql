CREATE TYPE "public"."driver_application_audit_action" AS ENUM('submitted', 'approved', 'rejected', 'revoked');--> statement-breakpoint
CREATE TABLE "driver_application_audit" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"application_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" "driver_application_audit_action" NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "driver_application_audit" ADD CONSTRAINT "driver_application_audit_application_id_driver_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."driver_application"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_application_audit" ADD CONSTRAINT "driver_application_audit_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_application_audit" ADD CONSTRAINT "driver_application_audit_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "driver_application_audit_ix_application" ON "driver_application_audit" USING btree ("application_id","occurred_at");--> statement-breakpoint
CREATE INDEX "driver_application_audit_ix_user" ON "driver_application_audit" USING btree ("user_id","occurred_at");
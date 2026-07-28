CREATE TYPE "public"."vehicle_audit_action" AS ENUM('approved', 'rejected', 'revoked');--> statement-breakpoint
CREATE TABLE "vehicle_audit" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" "vehicle_audit_action" NOT NULL,
	"reason" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vehicle_audit" ADD CONSTRAINT "vehicle_audit_vehicle_id_vehicle_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_audit" ADD CONSTRAINT "vehicle_audit_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_audit" ADD CONSTRAINT "vehicle_audit_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vehicle_audit_ix_vehicle" ON "vehicle_audit" USING btree ("vehicle_id","occurred_at");--> statement-breakpoint
CREATE INDEX "vehicle_audit_ix_user" ON "vehicle_audit" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "vehicle_audit_ix_action" ON "vehicle_audit" USING btree ("action","occurred_at");
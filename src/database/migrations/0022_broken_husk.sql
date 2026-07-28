CREATE TYPE "public"."document_review_status" AS ENUM('pending', 'approved', 'rejected', 'revoked');--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "driver_application_id" uuid;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "vehicle_id" uuid;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "review_status" "document_review_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "reviewer_id" uuid;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "review_reason" text;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_driver_application_id_driver_application_id_fk" FOREIGN KEY ("driver_application_id") REFERENCES "public"."driver_application"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_vehicle_id_vehicle_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_ix_review_status" ON "document" USING btree ("review_status");--> statement-breakpoint
CREATE INDEX "document_ix_driver_application_id" ON "document" USING btree ("driver_application_id");--> statement-breakpoint
CREATE INDEX "document_ix_vehicle_id" ON "document" USING btree ("vehicle_id");
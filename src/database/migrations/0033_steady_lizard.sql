ALTER TABLE "ride_request" ADD COLUMN "fare_estimate_id" uuid;--> statement-breakpoint
ALTER TABLE "ride_request" ADD COLUMN "vehicle_type" varchar(32);--> statement-breakpoint
ALTER TABLE "ride_request" ADD COLUMN "ride_type" varchar(32);--> statement-breakpoint
ALTER TABLE "ride_request" ADD COLUMN "currency" varchar(3);--> statement-breakpoint
ALTER TABLE "ride_request" ADD COLUMN "distance_meters" integer;--> statement-breakpoint
ALTER TABLE "ride_request" ADD COLUMN "duration_seconds" integer;--> statement-breakpoint
ALTER TABLE "ride_request" ADD COLUMN "rate_minor_per_km" integer;--> statement-breakpoint
ALTER TABLE "ride_request" ADD COLUMN "estimated_fare_minor" integer;--> statement-breakpoint
ALTER TABLE "ride_request" ADD CONSTRAINT "ride_request_fare_estimate_id_fare_estimate_id_fk" FOREIGN KEY ("fare_estimate_id") REFERENCES "public"."fare_estimate"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ride_request_uq_fare_estimate" ON "ride_request" USING btree ("fare_estimate_id") WHERE "ride_request"."fare_estimate_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "ride_request" ADD CONSTRAINT "ride_request_ck_ride_type_instant" CHECK ("ride_request"."ride_type" IS NULL OR "ride_request"."ride_type" = 'instant');--> statement-breakpoint
ALTER TABLE "ride_request" ADD CONSTRAINT "ride_request_ck_vehicle_type_standard" CHECK ("ride_request"."vehicle_type" IS NULL OR "ride_request"."vehicle_type" = 'standard');--> statement-breakpoint
ALTER TABLE "ride_request" ADD CONSTRAINT "ride_request_ck_currency_etb" CHECK ("ride_request"."currency" IS NULL OR "ride_request"."currency" = 'ETB');--> statement-breakpoint
ALTER TABLE "ride_request" ADD CONSTRAINT "ride_request_ck_distance_positive" CHECK ("ride_request"."distance_meters" IS NULL OR "ride_request"."distance_meters" > 0);--> statement-breakpoint
ALTER TABLE "ride_request" ADD CONSTRAINT "ride_request_ck_duration_positive" CHECK ("ride_request"."duration_seconds" IS NULL OR "ride_request"."duration_seconds" > 0);--> statement-breakpoint
ALTER TABLE "ride_request" ADD CONSTRAINT "ride_request_ck_rate_positive" CHECK ("ride_request"."rate_minor_per_km" IS NULL OR "ride_request"."rate_minor_per_km" > 0);--> statement-breakpoint
ALTER TABLE "ride_request" ADD CONSTRAINT "ride_request_ck_fare_nonnegative" CHECK ("ride_request"."estimated_fare_minor" IS NULL OR "ride_request"."estimated_fare_minor" >= 0);--> statement-breakpoint
ALTER TABLE "ride_request" ADD CONSTRAINT "ride_request_ck_fare_snapshot_all_or_none" CHECK ((
        "ride_request"."fare_estimate_id" IS NULL AND
        "ride_request"."vehicle_type" IS NULL AND
        "ride_request"."ride_type" IS NULL AND
        "ride_request"."currency" IS NULL AND
        "ride_request"."distance_meters" IS NULL AND
        "ride_request"."duration_seconds" IS NULL AND
        "ride_request"."rate_minor_per_km" IS NULL AND
        "ride_request"."estimated_fare_minor" IS NULL
      ) OR (
        "ride_request"."fare_estimate_id" IS NOT NULL AND
        "ride_request"."vehicle_type" IS NOT NULL AND
        "ride_request"."ride_type" IS NOT NULL AND
        "ride_request"."currency" IS NOT NULL AND
        "ride_request"."distance_meters" IS NOT NULL AND
        "ride_request"."duration_seconds" IS NOT NULL AND
        "ride_request"."rate_minor_per_km" IS NOT NULL AND
        "ride_request"."estimated_fare_minor" IS NOT NULL
      ));
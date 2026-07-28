CREATE TABLE "fare_estimate" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"rider_id" uuid NOT NULL,
	"pickup" geography(Point,4326) NOT NULL,
	"destination" geography(Point,4326) NOT NULL,
	"vehicle_type" varchar(32) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"distance_meters" integer NOT NULL,
	"duration_seconds" integer NOT NULL,
	"rate_minor_per_km" integer NOT NULL,
	"estimated_fare_minor" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fare_estimate_ck_vehicle_type_standard" CHECK ("fare_estimate"."vehicle_type" = 'standard'),
	CONSTRAINT "fare_estimate_ck_currency_etb" CHECK ("fare_estimate"."currency" = 'ETB'),
	CONSTRAINT "fare_estimate_ck_distance_positive" CHECK ("fare_estimate"."distance_meters" > 0),
	CONSTRAINT "fare_estimate_ck_duration_positive" CHECK ("fare_estimate"."duration_seconds" > 0),
	CONSTRAINT "fare_estimate_ck_rate_positive" CHECK ("fare_estimate"."rate_minor_per_km" > 0),
	CONSTRAINT "fare_estimate_ck_fare_nonnegative" CHECK ("fare_estimate"."estimated_fare_minor" >= 0),
	CONSTRAINT "fare_estimate_ck_expiry_after_creation" CHECK ("fare_estimate"."expires_at" > "fare_estimate"."created_at")
);
--> statement-breakpoint
ALTER TABLE "fare_estimate" ADD CONSTRAINT "fare_estimate_rider_id_user_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fare_estimate_ix_rider_created_at" ON "fare_estimate" USING btree ("rider_id","created_at");--> statement-breakpoint
CREATE INDEX "fare_estimate_ix_expires_at" ON "fare_estimate" USING btree ("expires_at");

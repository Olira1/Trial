CREATE TABLE "dispatch_assignment" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"request_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"rider_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone NOT NULL,
	"driver_full_name" varchar(255) NOT NULL,
	"driver_phone" varchar(32) NOT NULL,
	"driver_rating" integer NOT NULL,
	"vehicle_make" varchar(50) NOT NULL,
	"vehicle_model" varchar(50) NOT NULL,
	"vehicle_color" varchar(30) NOT NULL,
	"vehicle_plate_region" "plate_region" NOT NULL,
	"vehicle_plate_code" "plate_code" NOT NULL,
	"vehicle_plate_code_subtype" "plate_code_subtype",
	"vehicle_plate_number" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispatch_assignment_ck_driver_full_name_nonempty" CHECK (NULLIF(BTRIM("dispatch_assignment"."driver_full_name"), '') IS NOT NULL),
	CONSTRAINT "dispatch_assignment_ck_driver_phone_nonempty" CHECK (NULLIF(BTRIM("dispatch_assignment"."driver_phone"), '') IS NOT NULL),
	CONSTRAINT "dispatch_assignment_ck_driver_rating_range" CHECK ("dispatch_assignment"."driver_rating" BETWEEN 1 AND 5),
	CONSTRAINT "dispatch_assignment_ck_vehicle_make_nonempty" CHECK (NULLIF(BTRIM("dispatch_assignment"."vehicle_make"), '') IS NOT NULL),
	CONSTRAINT "dispatch_assignment_ck_vehicle_model_nonempty" CHECK (NULLIF(BTRIM("dispatch_assignment"."vehicle_model"), '') IS NOT NULL),
	CONSTRAINT "dispatch_assignment_ck_vehicle_color_nonempty" CHECK (NULLIF(BTRIM("dispatch_assignment"."vehicle_color"), '') IS NOT NULL),
	CONSTRAINT "dispatch_assignment_ck_vehicle_plate_number_nonempty" CHECK (NULLIF(BTRIM("dispatch_assignment"."vehicle_plate_number"), '') IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "dispatch_assignment" ADD CONSTRAINT "dispatch_assignment_request_id_ride_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."ride_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_assignment" ADD CONSTRAINT "dispatch_assignment_offer_id_dispatch_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."dispatch_offer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_assignment" ADD CONSTRAINT "dispatch_assignment_rider_id_user_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_assignment" ADD CONSTRAINT "dispatch_assignment_driver_id_user_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dispatch_assignment_uq_request" ON "dispatch_assignment" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dispatch_assignment_uq_offer" ON "dispatch_assignment" USING btree ("offer_id");
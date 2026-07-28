CREATE TYPE "public"."vehicle_qualification" AS ENUM('standard', 'comfort', 'ev', 'minibus');--> statement-breakpoint
CREATE TYPE "public"."vehicle_review_status" AS ENUM('pending', 'approved', 'rejected', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."approval_review_status" AS ENUM('pending', 'approved', 'rejected', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."driver_license_issuer" AS ENUM('addis_ababa', 'oromia', 'amhara', 'dire_dawa', 'tigray', 'afar', 'benishangul_gumuz', 'gambela', 'harari', 'sidama', 'somali', 'south_west', 'south_ethiopia', 'central_ethiopia');--> statement-breakpoint
CREATE TYPE "public"."driver_license_type" AS ENUM('T1', 'T2', 'P1', 'P2', 'F1', 'F2', 'F3', 'machinery', 'motorcycle');--> statement-breakpoint
CREATE TYPE "public"."driver_license_approval_audit_action" AS ENUM('approved', 'rejected', 'revoked');--> statement-breakpoint
CREATE TABLE "driver_license_approval" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"driver_application_id" uuid NOT NULL,
	"review_status" "approval_review_status" DEFAULT 'pending' NOT NULL,
	"issued_by" "driver_license_issuer",
	"license_type" "driver_license_type",
	"reviewer_id" uuid,
	"reviewed_at" timestamp with time zone,
	"review_reason" text,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_license_approval_audit" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"license_approval_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" "driver_license_approval_audit_action" NOT NULL,
	"reason" text NOT NULL,
	"issued_by" text,
	"license_type" text,
	"expires_at" timestamp with time zone,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vehicle" ADD COLUMN "review_status" "vehicle_review_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicle" ADD COLUMN "reviewer_id" uuid;--> statement-breakpoint
ALTER TABLE "vehicle" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vehicle" ADD COLUMN "review_reason" varchar(500);--> statement-breakpoint
ALTER TABLE "vehicle" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vehicle" ADD COLUMN "qualifications" "vehicle_qualification"[];--> statement-breakpoint
ALTER TABLE "vehicle" ADD COLUMN "review_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "vehicle_audit" ADD COLUMN "tin_number" text;--> statement-breakpoint
ALTER TABLE "vehicle_audit" ADD COLUMN "qualifications" text[];--> statement-breakpoint
ALTER TABLE "vehicle_audit" ADD COLUMN "snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "driver_license_approval" ADD CONSTRAINT "driver_license_approval_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_license_approval" ADD CONSTRAINT "driver_license_approval_driver_application_id_driver_application_id_fk" FOREIGN KEY ("driver_application_id") REFERENCES "public"."driver_application"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_license_approval" ADD CONSTRAINT "driver_license_approval_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_license_approval_audit" ADD CONSTRAINT "driver_license_approval_audit_license_approval_id_driver_license_approval_id_fk" FOREIGN KEY ("license_approval_id") REFERENCES "public"."driver_license_approval"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_license_approval_audit" ADD CONSTRAINT "driver_license_approval_audit_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_license_approval_audit" ADD CONSTRAINT "driver_license_approval_audit_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "driver_license_approval_uq_user" ON "driver_license_approval" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "driver_license_approval_ix_application" ON "driver_license_approval" USING btree ("driver_application_id");--> statement-breakpoint
CREATE INDEX "driver_license_approval_ix_status" ON "driver_license_approval" USING btree ("review_status");--> statement-breakpoint
CREATE INDEX "driver_license_approval_audit_ix_license" ON "driver_license_approval_audit" USING btree ("license_approval_id","occurred_at");--> statement-breakpoint
CREATE INDEX "driver_license_approval_audit_ix_user" ON "driver_license_approval_audit" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "driver_license_approval_audit_ix_action" ON "driver_license_approval_audit" USING btree ("action","occurred_at");--> statement-breakpoint
ALTER TABLE "vehicle" ADD CONSTRAINT "vehicle_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
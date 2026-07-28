CREATE TYPE "public"."gender" AS ENUM('male', 'female');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('rider', 'driver', 'admin', 'super_admin');--> statement-breakpoint
CREATE TYPE "public"."ownership_type" AS ENUM('owner', 'representative');--> statement-breakpoint
CREATE TYPE "public"."plate_code" AS ENUM('01', '02', '03');--> statement-breakpoint
CREATE TYPE "public"."plate_code_subtype" AS ENUM('transport_service', 'other');--> statement-breakpoint
CREATE TYPE "public"."plate_region" AS ENUM('aa', 'or', 'ah', 'dr', 'tg');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('vehicle_ownership', 'representation_letter', 'driver_license_front', 'driver_license_back', 'vehicle_photo_front', 'vehicle_photo_side', 'vehicle_photo_back', 'bolo', 'third_party_insurance', 'trade_license');--> statement-breakpoint
CREATE TYPE "public"."application_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."auth_identity_type" AS ENUM('phone', 'email', 'passkey');--> statement-breakpoint
CREATE TYPE "public"."otp_channel" AS ENUM('phone', 'email');--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"full_name" varchar(100) NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"phone_verified" boolean DEFAULT false NOT NULL,
	"device_id" varchar(255),
	"roles" "user_role"[] DEFAULT '{"rider"}' NOT NULL,
	"gender" "gender",
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"ownership_type" "ownership_type" NOT NULL,
	"make" varchar(50) NOT NULL,
	"model" varchar(50) NOT NULL,
	"color" varchar(30) NOT NULL,
	"plate_region" "plate_region" NOT NULL,
	"plate_code" "plate_code" NOT NULL,
	"plate_code_subtype" "plate_code_subtype",
	"plate_number" varchar(20) NOT NULL,
	"tin_number" varchar(50),
	"is_approved" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"document_type" "document_type" NOT NULL,
	"storage_key" varchar(255) NOT NULL,
	"url" varchar(500) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_application" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "application_status" DEFAULT 'pending' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewer_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_identity" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "auth_identity_type" NOT NULL,
	"identifier" text NOT NULL,
	"verified_at" timestamp with time zone,
	"password_hash" text,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_challenge" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"identity_id" uuid NOT NULL,
	"destination" text NOT NULL,
	"channel" "otp_channel" NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passkey_credential" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"identity_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" varchar(512) NOT NULL,
	"public_key" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"device_type" varchar(20) NOT NULL,
	"backed_up" boolean DEFAULT false NOT NULL,
	"transports" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_session" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vehicle" ADD CONSTRAINT "vehicle_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_application" ADD CONSTRAINT "driver_application_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_application" ADD CONSTRAINT "driver_application_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_identity" ADD CONSTRAINT "auth_identity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_challenge" ADD CONSTRAINT "otp_challenge_identity_id_auth_identity_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."auth_identity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey_credential" ADD CONSTRAINT "passkey_credential_identity_id_auth_identity_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."auth_identity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey_credential" ADD CONSTRAINT "passkey_credential_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vehicle_ix_user_id" ON "vehicle" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_uq_plate_number" ON "vehicle" USING btree ("plate_number");--> statement-breakpoint
CREATE INDEX "document_ix_user_id" ON "document" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "driver_application_uq_user_id" ON "driver_application" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "driver_application_ix_status" ON "driver_application" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_identity_uq_type_identifier" ON "auth_identity" USING btree ("type","identifier");--> statement-breakpoint
CREATE INDEX "auth_identity_ix_user_id" ON "auth_identity" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "otp_challenge_ix_destination_channel" ON "otp_challenge" USING btree ("destination","channel");--> statement-breakpoint
CREATE INDEX "otp_challenge_ix_expires_at" ON "otp_challenge" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "passkey_credential_uq_identity_id" ON "passkey_credential" USING btree ("identity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "passkey_credential_uq_credential_id" ON "passkey_credential" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "passkey_credential_ix_user_id" ON "passkey_credential" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_session_uq_token_hash" ON "auth_session" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_session_ix_user_id" ON "auth_session" USING btree ("user_id");
CREATE TYPE "public"."support_bug_area" AS ENUM('crash', 'ui_layout', 'booking', 'other');--> statement-breakpoint
CREATE TYPE "public"."support_bug_impact" AS ENUM('minor_glitch', 'feature_broken', 'cant_use_app');--> statement-breakpoint
CREATE TYPE "public"."support_bug_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."support_contact_type" AS ENUM('emergency', 'trusted');--> statement-breakpoint
CREATE TYPE "public"."support_feedback_topic" AS ENUM('app_experience', 'driver_trip', 'support', 'other');--> statement-breakpoint
CREATE TABLE "support_bug_report" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"severity" "support_bug_severity" NOT NULL,
	"impact" "support_bug_impact" NOT NULL,
	"area" "support_bug_area" NOT NULL,
	"details" text NOT NULL,
	"steps_to_reproduce" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_bug_report_screenshot" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"bug_report_id" uuid NOT NULL,
	"storage_key" varchar(255) NOT NULL,
	"url" varchar(500) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_contact" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "support_contact_type" NOT NULL,
	"name" varchar(100) NOT NULL,
	"phone" varchar(20) NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_feedback" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"topic" "support_feedback_topic" NOT NULL,
	"would_recommend" boolean NOT NULL,
	"title" varchar(120),
	"feedback" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_bug_report" ADD CONSTRAINT "support_bug_report_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_bug_report_screenshot" ADD CONSTRAINT "support_bug_report_screenshot_bug_report_id_support_bug_report_id_fk" FOREIGN KEY ("bug_report_id") REFERENCES "public"."support_bug_report"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_contact" ADD CONSTRAINT "support_contact_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_feedback" ADD CONSTRAINT "support_feedback_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_bug_report_ix_user_id" ON "support_bug_report" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "support_bug_report_screenshot_ix_bug_report_id" ON "support_bug_report_screenshot" USING btree ("bug_report_id");--> statement-breakpoint
CREATE INDEX "support_contact_ix_user_id_type" ON "support_contact" USING btree ("user_id","type");--> statement-breakpoint
CREATE INDEX "support_feedback_ix_user_id" ON "support_feedback" USING btree ("user_id");
CREATE TYPE "public"."notification_category" AS ENUM('all_users', 'all_drivers', 'all_riders', 'verified_users_only');--> statement-breakpoint
CREATE TYPE "public"."notification_source" AS ENUM('admin', 'system');--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"title" varchar(120) NOT NULL,
	"body" text NOT NULL,
	"category" "notification_category",
	"source" "notification_source" DEFAULT 'admin' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_notification" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"notification_id" uuid NOT NULL,
	"seen_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notification" ADD CONSTRAINT "user_notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notification" ADD CONSTRAINT "user_notification_notification_id_notification_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notification"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_ix_created_at" ON "notification" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notification_ix_category" ON "notification" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX "user_notification_uq_user_notification" ON "user_notification" USING btree ("user_id","notification_id");--> statement-breakpoint
CREATE INDEX "user_notification_ix_user_created" ON "user_notification" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "user_notification_ix_user_seen" ON "user_notification" USING btree ("user_id","seen_at");--> statement-breakpoint
CREATE INDEX "user_notification_ix_deleted_at" ON "user_notification" USING btree ("deleted_at");
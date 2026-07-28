CREATE TYPE "public"."ad_banner_audience" AS ENUM('all_users', 'riders', 'drivers');--> statement-breakpoint
ALTER TABLE "ad_banner" ADD COLUMN "audience" "ad_banner_audience" DEFAULT 'all_users' NOT NULL;--> statement-breakpoint
CREATE INDEX "ad_banner_ix_audience" ON "ad_banner" USING btree ("audience");
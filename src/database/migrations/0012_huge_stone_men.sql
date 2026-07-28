ALTER TABLE "ad_banner" ADD COLUMN "starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ad_banner" ADD COLUMN "ends_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "ad_banner_ix_active_window_sort" ON "ad_banner" USING btree ("is_active","starts_at","ends_at","sort_order");
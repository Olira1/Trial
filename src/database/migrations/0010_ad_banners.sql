CREATE TABLE "ad_banner" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"title" varchar(120),
	"image_key" varchar(1024) NOT NULL,
	"link_url" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ad_banner_ix_active_sort" ON "ad_banner" USING btree ("is_active","sort_order");--> statement-breakpoint
CREATE INDEX "ad_banner_ix_deleted_at" ON "ad_banner" USING btree ("deleted_at");
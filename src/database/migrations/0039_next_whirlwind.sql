ALTER TABLE "user" ADD COLUMN "image_key" varchar(1024);--> statement-breakpoint
UPDATE "user"
SET "image_key" = substring("image" from '(profile-images/[0-9a-fA-F-]+/[^?#]+)')
WHERE "image" IS NOT NULL
  AND substring("image" from '(profile-images/[0-9a-fA-F-]+/[^?#]+)') LIKE ('profile-images/' || "id"::text || '/%');--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "image";--> statement-breakpoint
ALTER TABLE "document" DROP COLUMN "url";--> statement-breakpoint
ALTER TABLE "support_bug_report_screenshot" DROP COLUMN "url";

ALTER TABLE "vehicle" ADD COLUMN "year" integer;--> statement-breakpoint
UPDATE "vehicle" SET "year" = 2000 WHERE "year" IS NULL;--> statement-breakpoint
ALTER TABLE "vehicle" ALTER COLUMN "year" SET NOT NULL;

ALTER TABLE "user" ADD COLUMN "first_name" varchar(100);--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "middle_name" varchar(100);--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "last_name" varchar(100);--> statement-breakpoint
UPDATE "user" AS "u"
SET
	"first_name" = split_part("names"."normalized_name", ' ', 1),
	"middle_name" = CASE
		WHEN "names"."normalized_name" ~ '^[^ ]+ .+ [^ ]+$'
			THEN regexp_replace("names"."normalized_name", '^[^ ]+ (.+) [^ ]+$', '\1')
		ELSE NULL
	END,
	"last_name" = CASE
		WHEN position(' ' IN "names"."normalized_name") = 0
			THEN "names"."normalized_name"
		ELSE regexp_replace("names"."normalized_name", '^.* ', '')
	END
FROM (
	SELECT "id", regexp_replace(btrim("full_name"), '\s+', ' ', 'g') AS "normalized_name"
	FROM "user"
) AS "names"
WHERE "u"."id" = "names"."id";--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "first_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "last_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "full_name";

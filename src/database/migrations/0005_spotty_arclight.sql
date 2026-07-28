CREATE TYPE "public"."reward_source" AS ENUM('early_joiner_daily');--> statement-breakpoint
CREATE TABLE "user_reward_ledger" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"reward_date" date NOT NULL,
	"miles" numeric(10, 1) NOT NULL,
	"source" "reward_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_reward_ledger" ADD CONSTRAINT "user_reward_ledger_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_reward_ledger_uq_user_date_source" ON "user_reward_ledger" USING btree ("user_id","reward_date","source");--> statement-breakpoint
CREATE INDEX "user_reward_ledger_ix_user_id" ON "user_reward_ledger" USING btree ("user_id");
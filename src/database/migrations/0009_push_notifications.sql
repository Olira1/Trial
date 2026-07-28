CREATE TYPE "public"."push_platform" AS ENUM('android', 'ios', 'web');--> statement-breakpoint
CREATE TABLE "push_device_token" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" varchar(255) NOT NULL,
	"platform" "push_platform" NOT NULL,
	"token" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "push_device_token" ADD CONSTRAINT "push_device_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "push_device_token_uq_user_device" ON "push_device_token" USING btree ("user_id","device_id");--> statement-breakpoint
CREATE INDEX "push_device_token_ix_user_id" ON "push_device_token" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "push_device_token_ix_token" ON "push_device_token" USING btree ("token");
CREATE TABLE "auth_identity_history" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"identity_id" uuid NOT NULL,
	"type" "auth_identity_type" NOT NULL,
	"identifier_hash" text NOT NULL,
	"identifier_masked" text NOT NULL,
	"verified_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_identity_history" ADD CONSTRAINT "auth_identity_history_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_identity_history_ix_user_id" ON "auth_identity_history" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_identity_history_ix_identity_id" ON "auth_identity_history" USING btree ("identity_id");--> statement-breakpoint
CREATE INDEX "auth_identity_history_ix_identifier_hash" ON "auth_identity_history" USING btree ("identifier_hash");--> statement-breakpoint
CREATE INDEX "auth_identity_history_ix_deleted_at" ON "auth_identity_history" USING btree ("deleted_at");

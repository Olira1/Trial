CREATE TYPE "public"."document_audit_action" AS ENUM('approved', 'rejected', 'revoked');--> statement-breakpoint
CREATE TABLE "document_audit" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"document_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" "document_audit_action" NOT NULL,
	"reason" text NOT NULL,
	"expires_at" timestamp with time zone,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_audit" ADD CONSTRAINT "document_audit_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_audit" ADD CONSTRAINT "document_audit_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_audit" ADD CONSTRAINT "document_audit_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_audit_ix_document" ON "document_audit" USING btree ("document_id","occurred_at");--> statement-breakpoint
CREATE INDEX "document_audit_ix_user" ON "document_audit" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "document_audit_ix_action" ON "document_audit" USING btree ("action","occurred_at");
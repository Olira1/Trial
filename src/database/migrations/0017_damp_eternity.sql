CREATE TABLE "dispatch_outbox_event" (
	"event_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"event_key" varchar(240) NOT NULL,
	"event_type" varchar(120) NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"aggregate_type" varchar(80) NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"correlation_id" uuid NOT NULL,
	"causation_id" uuid,
	"actor_user_id" uuid,
	"payload" jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"publish_attempts" integer DEFAULT 0 NOT NULL,
	"last_publish_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "dispatch_outbox_event_uq_event_key" ON "dispatch_outbox_event" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX "dispatch_outbox_event_ix_unpublished" ON "dispatch_outbox_event" USING btree ("published_at","event_id");--> statement-breakpoint
CREATE INDEX "dispatch_outbox_event_ix_correlation_id" ON "dispatch_outbox_event" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "dispatch_outbox_event_ix_aggregate" ON "dispatch_outbox_event" USING btree ("aggregate_type","aggregate_id");
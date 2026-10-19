CREATE TABLE "quote_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sm8_contact_uuid" uuid NOT NULL,
	"sm8_job_uuid" uuid NOT NULL,
	"first" text,
	"last" text,
	"phone" text,
	"mobile" text,
	"email" text,
	"contact_type" text,
	"sm8_active" boolean DEFAULT true NOT NULL,
	"edit_date_raw" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quote_contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "event_consumer_cursors" (
	"consumer" text PRIMARY KEY NOT NULL,
	"last_event_id" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_consumer_cursors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "quote_status_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"sm8_job_uuid" uuid NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quote_status_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"outcome" text NOT NULL,
	"jobs_fetched" integer DEFAULT 0 NOT NULL,
	"jobs_upserted" integer DEFAULT 0 NOT NULL,
	"contacts_fetched" integer DEFAULT 0 NOT NULL,
	"events_emitted" integer DEFAULT 0 NOT NULL,
	"error_detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sync_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "operator_allowlist" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operator_allowlist" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quote_contacts" ADD CONSTRAINT "quote_contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quote_contacts_tenant_contact_uniq" ON "quote_contacts" USING btree ("tenant_id","sm8_contact_uuid");--> statement-breakpoint
CREATE INDEX "quote_contacts_tenant_job_idx" ON "quote_contacts" USING btree ("tenant_id","sm8_job_uuid");--> statement-breakpoint
CREATE INDEX "quote_status_events_tenant_quote_idx" ON "quote_status_events" USING btree ("tenant_id","quote_id");--> statement-breakpoint
CREATE INDEX "sync_runs_tenant_started_idx" ON "sync_runs" USING btree ("tenant_id","started_at");--> statement-breakpoint
CREATE POLICY "quote_contacts_member_access" ON "quote_contacts" AS PERMISSIVE FOR ALL TO "authenticated" USING (has_tenant_access(tenant_id)) WITH CHECK (has_tenant_access(tenant_id));--> statement-breakpoint
CREATE POLICY "event_consumer_cursors_operator_access" ON "event_consumer_cursors" AS PERMISSIVE FOR ALL TO "authenticated" USING (is_operator()) WITH CHECK (is_operator());--> statement-breakpoint
CREATE POLICY "quote_status_events_member_access" ON "quote_status_events" AS PERMISSIVE FOR ALL TO "authenticated" USING (has_tenant_access(tenant_id)) WITH CHECK (has_tenant_access(tenant_id));--> statement-breakpoint
CREATE POLICY "sync_runs_member_access" ON "sync_runs" AS PERMISSIVE FOR ALL TO "authenticated" USING (has_tenant_access(tenant_id)) WITH CHECK (has_tenant_access(tenant_id));--> statement-breakpoint
CREATE POLICY "operator_allowlist_operator_access" ON "operator_allowlist" AS PERMISSIVE FOR ALL TO "authenticated" USING (is_operator()) WITH CHECK (is_operator());
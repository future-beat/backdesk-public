CREATE TABLE "sm8_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"api_key_ciphertext" text NOT NULL,
	"key_last4" text NOT NULL,
	"job_cursor" text,
	"contact_cursor" text,
	"paused_at" timestamp with time zone,
	"status_reason" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"alerted_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"baseline_win_rate" numeric(5, 4),
	"baseline_quotes_issued" integer,
	"baseline_window_start" date,
	"baseline_window_end" date,
	"baseline_computed_at" timestamp with time zone,
	"sm8_tz_offset_minutes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sm8_connections_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "sm8_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sm8_job_uuid" uuid NOT NULL,
	"status" text NOT NULL,
	"sm8_active" boolean DEFAULT true NOT NULL,
	"generated_job_id" text,
	"job_address" text,
	"job_description" text,
	"company_uuid" uuid,
	"total_invoice_amount" numeric(12, 2),
	"quote_sent" boolean,
	"edit_date_raw" text NOT NULL,
	"edit_date_utc" timestamp with time zone,
	"date_raw" text,
	"quote_date_raw" text,
	"quote_date_utc" timestamp with time zone,
	"work_order_date_raw" text,
	"work_order_date_utc" timestamp with time zone,
	"completion_date_raw" text,
	"completion_date_utc" timestamp with time zone,
	"unsuccessful_date_raw" text,
	"unsuccessful_date_utc" timestamp with time zone,
	"quote_sent_stamp_raw" text,
	"quote_sent_stamp_utc" timestamp with time zone,
	"chase_eligibility" text DEFAULT 'needs_review' NOT NULL,
	"sync_source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quotes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sm8_connections" ADD CONSTRAINT "sm8_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_tenant_job_uniq" ON "quotes" USING btree ("tenant_id","sm8_job_uuid");--> statement-breakpoint
CREATE POLICY "sm8_connections_member_access" ON "sm8_connections" AS PERMISSIVE FOR ALL TO "authenticated" USING (has_tenant_access(tenant_id)) WITH CHECK (has_tenant_access(tenant_id));--> statement-breakpoint
CREATE POLICY "quotes_member_access" ON "quotes" AS PERMISSIVE FOR ALL TO "authenticated" USING (has_tenant_access(tenant_id)) WITH CHECK (has_tenant_access(tenant_id));
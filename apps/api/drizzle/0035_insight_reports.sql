CREATE TABLE "insight_reports" (
	"tenant_id" uuid NOT NULL,
	"scope_key" text NOT NULL,
	"day" text NOT NULL,
	"report" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insight_reports_tenant_id_scope_key_day_pk" PRIMARY KEY("tenant_id","scope_key","day")
);
--> statement-breakpoint
ALTER TABLE "insight_reports" ADD CONSTRAINT "insight_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_reports" ADD CONSTRAINT "insight_reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
CREATE TABLE "institution_metrics" (
	"tenant_id" uuid NOT NULL,
	"day" text NOT NULL,
	"students" integer NOT NULL,
	"values" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "institution_metrics_tenant_id_day_pk" PRIMARY KEY("tenant_id","day")
);
--> statement-breakpoint
ALTER TABLE "institution_metrics" ADD CONSTRAINT "institution_metrics_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "institution_metrics_day_idx" ON "institution_metrics" USING btree ("day");
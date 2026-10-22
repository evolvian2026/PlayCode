CREATE TABLE "sso_connections" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"issuer" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret_enc" text NOT NULL,
	"email_domains" jsonb NOT NULL,
	"auto_provision_unit_id" uuid,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sso_connections" ADD CONSTRAINT "sso_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso_connections" ADD CONSTRAINT "sso_connections_auto_provision_unit_id_org_units_id_fk" FOREIGN KEY ("auto_provision_unit_id") REFERENCES "public"."org_units"("id") ON DELETE set null ON UPDATE no action;
CREATE TABLE "saml_connections" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"idp_entity_id" text NOT NULL,
	"sso_url" text NOT NULL,
	"certificates" jsonb NOT NULL,
	"email_attribute" text,
	"email_domains" jsonb NOT NULL,
	"auto_provision_unit_id" uuid,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saml_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saml_connections" ADD CONSTRAINT "saml_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saml_connections" ADD CONSTRAINT "saml_connections_auto_provision_unit_id_org_units_id_fk" FOREIGN KEY ("auto_provision_unit_id") REFERENCES "public"."org_units"("id") ON DELETE set null ON UPDATE no action;
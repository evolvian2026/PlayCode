CREATE TABLE "scim_connections" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"default_unit_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "scim_connections_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "scim_external_id" text;--> statement-breakpoint
ALTER TABLE "scim_connections" ADD CONSTRAINT "scim_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_connections" ADD CONSTRAINT "scim_connections_default_unit_id_org_units_id_fk" FOREIGN KEY ("default_unit_id") REFERENCES "public"."org_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_connections" ADD CONSTRAINT "scim_connections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
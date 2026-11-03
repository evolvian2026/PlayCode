CREATE TABLE "lti_accounts" (
	"platform_id" uuid NOT NULL,
	"sub" text NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lti_accounts_platform_id_sub_pk" PRIMARY KEY("platform_id","sub")
);
--> statement-breakpoint
CREATE TABLE "lti_keys" (
	"kid" text PRIMARY KEY NOT NULL,
	"public_jwk" jsonb NOT NULL,
	"private_key_enc" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lti_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform_id" uuid NOT NULL,
	"resource_link_id" text NOT NULL,
	"title" text,
	"context_title" text,
	"assignment_id" uuid,
	"lineitem_url" text,
	"ags_scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lti_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lti_platforms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"issuer" text NOT NULL,
	"client_id" text NOT NULL,
	"deployment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"auth_login_url" text NOT NULL,
	"auth_token_url" text NOT NULL,
	"jwks_url" text NOT NULL,
	"auto_provision_unit_id" uuid,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lti_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"lti_sub" text NOT NULL,
	"score_given" integer NOT NULL,
	"score_maximum" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lti_accounts" ADD CONSTRAINT "lti_accounts_platform_id_lti_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."lti_platforms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lti_accounts" ADD CONSTRAINT "lti_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lti_links" ADD CONSTRAINT "lti_links_platform_id_lti_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."lti_platforms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lti_links" ADD CONSTRAINT "lti_links_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lti_platforms" ADD CONSTRAINT "lti_platforms_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lti_platforms" ADD CONSTRAINT "lti_platforms_auto_provision_unit_id_org_units_id_fk" FOREIGN KEY ("auto_provision_unit_id") REFERENCES "public"."org_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lti_scores" ADD CONSTRAINT "lti_scores_link_id_lti_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."lti_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lti_scores" ADD CONSTRAINT "lti_scores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lti_accounts_user_idx" ON "lti_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lti_links_platform_resource_uq" ON "lti_links" USING btree ("platform_id","resource_link_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lti_platforms_issuer_client_uq" ON "lti_platforms" USING btree ("issuer","client_id");--> statement-breakpoint
CREATE INDEX "lti_scores_due_idx" ON "lti_scores" USING btree ("status","next_attempt_at");
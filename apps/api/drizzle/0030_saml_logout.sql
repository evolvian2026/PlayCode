ALTER TABLE "auth_sessions" ADD COLUMN "saml" jsonb;--> statement-breakpoint
ALTER TABLE "saml_connections" ADD COLUMN "slo_url" text;--> statement-breakpoint
ALTER TABLE "saml_connections" ADD COLUMN "require_encryption" boolean DEFAULT false NOT NULL;
CREATE TABLE "lti_deep_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"deployment_id" text NOT NULL,
	"return_url" text NOT NULL,
	"data" text,
	"accept_multiple" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lti_deep_links" ADD CONSTRAINT "lti_deep_links_platform_id_lti_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."lti_platforms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lti_deep_links" ADD CONSTRAINT "lti_deep_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
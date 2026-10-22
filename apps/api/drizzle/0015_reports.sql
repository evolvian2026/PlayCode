CREATE TABLE "report_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"unit_id" uuid,
	"weekday" integer DEFAULT 1 NOT NULL,
	"hour" integer DEFAULT 8 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_sent_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_subscriptions" ADD CONSTRAINT "report_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_subscriptions" ADD CONSTRAINT "report_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_subscriptions" ADD CONSTRAINT "report_subscriptions_unit_id_org_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."org_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "report_subscriptions_user_uq" ON "report_subscriptions" USING btree ("user_id","tenant_id");
CREATE TABLE "self_intros" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"target_role" text DEFAULT '' NOT NULL,
	"extra" text DEFAULT '' NOT NULL,
	"script" text DEFAULT '' NOT NULL,
	"drafted_at" timestamp with time zone,
	"practice" jsonb DEFAULT '{"runs":0,"best":null,"last":null}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "self_intros" ADD CONSTRAINT "self_intros_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_intros" ADD CONSTRAINT "self_intros_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
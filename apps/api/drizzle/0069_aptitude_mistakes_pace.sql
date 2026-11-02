CREATE TABLE "aptitude_mistake_fixes" (
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"template" text NOT NULL,
	"level" integer NOT NULL,
	"seed" integer NOT NULL,
	"fixed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "aptitude_mistake_fixes_user_id_template_level_seed_pk" PRIMARY KEY("user_id","template","level","seed")
);
--> statement-breakpoint
ALTER TABLE "aptitude_drill_answers" ADD COLUMN "chosen" integer;--> statement-breakpoint
ALTER TABLE "aptitude_drill_answers" ADD COLUMN "seconds" integer;--> statement-breakpoint
ALTER TABLE "aptitude_mistake_fixes" ADD CONSTRAINT "aptitude_mistake_fixes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aptitude_mistake_fixes" ADD CONSTRAINT "aptitude_mistake_fixes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
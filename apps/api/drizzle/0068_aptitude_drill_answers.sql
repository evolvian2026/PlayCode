CREATE TABLE "aptitude_drill_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"template" text NOT NULL,
	"level" integer NOT NULL,
	"seed" integer NOT NULL,
	"correct" boolean NOT NULL,
	"answered_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "aptitude_drill_answers" ADD CONSTRAINT "aptitude_drill_answers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aptitude_drill_answers" ADD CONSTRAINT "aptitude_drill_answers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "aptitude_drill_answers_question_uq" ON "aptitude_drill_answers" USING btree ("user_id","template","level","seed");--> statement-breakpoint
CREATE INDEX "aptitude_drill_answers_user_idx" ON "aptitude_drill_answers" USING btree ("user_id","answered_at");
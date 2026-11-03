CREATE TABLE "aptitude_homework" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"unit_ids" jsonb NOT NULL,
	"parts" jsonb NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"reminded_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aptitude_homework_work" (
	"homework_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"questions" jsonb NOT NULL,
	"correct" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "aptitude_homework_work_homework_id_user_id_pk" PRIMARY KEY("homework_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "aptitude_homework" ADD CONSTRAINT "aptitude_homework_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aptitude_homework_work" ADD CONSTRAINT "aptitude_homework_work_homework_id_aptitude_homework_id_fk" FOREIGN KEY ("homework_id") REFERENCES "public"."aptitude_homework"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aptitude_homework_work" ADD CONSTRAINT "aptitude_homework_work_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aptitude_homework_work" ADD CONSTRAINT "aptitude_homework_work_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "aptitude_homework_tenant_idx" ON "aptitude_homework" USING btree ("tenant_id","due_at");--> statement-breakpoint
CREATE INDEX "aptitude_homework_work_user_idx" ON "aptitude_homework_work" USING btree ("user_id");
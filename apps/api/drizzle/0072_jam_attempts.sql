CREATE TABLE "jam_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"topic_id" text NOT NULL,
	"transcript" text NOT NULL,
	"spoken_ms" integer NOT NULL,
	"words" integer NOT NULL,
	"wpm" integer NOT NULL,
	"fillers" integer NOT NULL,
	"feedback" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jam_attempts" ADD CONSTRAINT "jam_attempts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jam_attempts" ADD CONSTRAINT "jam_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jam_attempts_user_idx" ON "jam_attempts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "jam_attempts_tenant_idx" ON "jam_attempts" USING btree ("tenant_id","created_at");
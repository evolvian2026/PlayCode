CREATE TABLE "on_duty_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"date" text NOT NULL,
	"part" text NOT NULL,
	"reason" text NOT NULL,
	"drive_id" uuid,
	"opening_id" uuid,
	"purpose" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "on_duty_requests" ADD CONSTRAINT "on_duty_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "on_duty_requests" ADD CONSTRAINT "on_duty_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "on_duty_requests" ADD CONSTRAINT "on_duty_requests_drive_id_placement_drives_id_fk" FOREIGN KEY ("drive_id") REFERENCES "public"."placement_drives"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "on_duty_requests" ADD CONSTRAINT "on_duty_requests_opening_id_placement_openings_id_fk" FOREIGN KEY ("opening_id") REFERENCES "public"."placement_openings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "on_duty_user_idx" ON "on_duty_requests" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "on_duty_tenant_idx" ON "on_duty_requests" USING btree ("tenant_id","date");
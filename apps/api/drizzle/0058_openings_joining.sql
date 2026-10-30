CREATE TABLE "opening_responses" (
	"opening_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"response" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "opening_responses_opening_id_user_id_pk" PRIMARY KEY("opening_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "placement_openings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"company" text NOT NULL,
	"role_title" text NOT NULL,
	"pay_rupees" integer,
	"location" text DEFAULT '' NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"apply_url" text,
	"closes_on" text NOT NULL,
	"criteria" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"withdrawn_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "placement_applications" ADD COLUMN "joining_status" text;--> statement-breakpoint
ALTER TABLE "placement_applications" ADD COLUMN "joining_date" text;--> statement-breakpoint
ALTER TABLE "placement_applications" ADD COLUMN "joining_note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "placement_applications" ADD COLUMN "joining_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "opening_responses" ADD CONSTRAINT "opening_responses_opening_id_placement_openings_id_fk" FOREIGN KEY ("opening_id") REFERENCES "public"."placement_openings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_responses" ADD CONSTRAINT "opening_responses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_responses" ADD CONSTRAINT "opening_responses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placement_openings" ADD CONSTRAINT "placement_openings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "opening_responses_user_idx" ON "opening_responses" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "placement_openings_tenant_idx" ON "placement_openings" USING btree ("tenant_id","closes_on");
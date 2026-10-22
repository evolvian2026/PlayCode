CREATE TABLE "academic_records" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cgpa" double precision,
	"backlogs" integer,
	"tenth_pct" double precision,
	"twelfth_pct" double precision,
	"graduation_year" integer,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"track" text NOT NULL,
	"focus_skills" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"turns" jsonb NOT NULL,
	"scorecard" jsonb,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "placement_applications" (
	"drive_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"status" text DEFAULT 'registered' NOT NULL,
	"rounds_cleared" integer DEFAULT 0 NOT NULL,
	"offer_ctc_rupees" integer,
	"readiness" jsonb NOT NULL,
	"active_days_60" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "placement_applications_drive_id_user_id_pk" PRIMARY KEY("drive_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "placement_drives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company" text NOT NULL,
	"company_type" text NOT NULL,
	"role_title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"ctc_rupees" integer NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"drive_date" text NOT NULL,
	"register_by" timestamp with time zone NOT NULL,
	"criteria" jsonb NOT NULL,
	"rounds" jsonb NOT NULL,
	"pack_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "paid_via" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "payment_ref" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "payment_link_id" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "payment_link_url" text;--> statement-breakpoint
ALTER TABLE "academic_records" ADD CONSTRAINT "academic_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic_records" ADD CONSTRAINT "academic_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placement_applications" ADD CONSTRAINT "placement_applications_drive_id_placement_drives_id_fk" FOREIGN KEY ("drive_id") REFERENCES "public"."placement_drives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placement_applications" ADD CONSTRAINT "placement_applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placement_applications" ADD CONSTRAINT "placement_applications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placement_drives" ADD CONSTRAINT "placement_drives_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placement_drives" ADD CONSTRAINT "placement_drives_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interviews_user_idx" ON "interviews" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "interviews_tenant_idx" ON "interviews" USING btree ("tenant_id","started_at");--> statement-breakpoint
CREATE INDEX "placement_applications_user_idx" ON "placement_applications" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "placement_drives_tenant_idx" ON "placement_drives" USING btree ("tenant_id","drive_date");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_payment_link_uq" ON "invoices" USING btree ("payment_link_id");
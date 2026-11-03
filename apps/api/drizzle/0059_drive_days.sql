CREATE TABLE "drive_check_ins" (
	"drive_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reported_at" timestamp with time zone NOT NULL,
	"by_id" uuid NOT NULL,
	CONSTRAINT "drive_check_ins_drive_id_user_id_pk" PRIMARY KEY("drive_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "drive_coordinators" (
	"drive_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"added_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "drive_coordinators_drive_id_user_id_pk" PRIMARY KEY("drive_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "drive_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"drive_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"audience" text NOT NULL,
	"round" integer,
	"body" text NOT NULL,
	"recipients" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "placement_drives" ADD COLUMN "offer_details" jsonb;--> statement-breakpoint
ALTER TABLE "drive_check_ins" ADD CONSTRAINT "drive_check_ins_drive_id_placement_drives_id_fk" FOREIGN KEY ("drive_id") REFERENCES "public"."placement_drives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_check_ins" ADD CONSTRAINT "drive_check_ins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_check_ins" ADD CONSTRAINT "drive_check_ins_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_coordinators" ADD CONSTRAINT "drive_coordinators_drive_id_placement_drives_id_fk" FOREIGN KEY ("drive_id") REFERENCES "public"."placement_drives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_coordinators" ADD CONSTRAINT "drive_coordinators_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_coordinators" ADD CONSTRAINT "drive_coordinators_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_updates" ADD CONSTRAINT "drive_updates_drive_id_placement_drives_id_fk" FOREIGN KEY ("drive_id") REFERENCES "public"."placement_drives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_updates" ADD CONSTRAINT "drive_updates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "drive_coordinators_user_idx" ON "drive_coordinators" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "drive_updates_drive_idx" ON "drive_updates" USING btree ("drive_id","created_at");
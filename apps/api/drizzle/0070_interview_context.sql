ALTER TABLE "interviews" ADD COLUMN "drive_id" uuid;--> statement-breakpoint
ALTER TABLE "interviews" ADD COLUMN "context" jsonb;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_drive_id_placement_drives_id_fk" FOREIGN KEY ("drive_id") REFERENCES "public"."placement_drives"("id") ON DELETE set null ON UPDATE no action;
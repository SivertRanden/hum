CREATE TABLE "last_read" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"space_id" integer NOT NULL,
	"channel" text NOT NULL,
	"last_read_message_id" integer DEFAULT 0 NOT NULL,
	"updated_at" integer DEFAULT extract(epoch from now())::int NOT NULL
);
--> statement-breakpoint
ALTER TABLE "last_read" ADD CONSTRAINT "last_read_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "last_read" ADD CONSTRAINT "last_read_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "last_read_user_space_channel_unique" ON "last_read" USING btree ("user_id","space_id","channel");

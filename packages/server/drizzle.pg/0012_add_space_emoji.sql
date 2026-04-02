CREATE TABLE "space_emoji" (
  "id" serial PRIMARY KEY NOT NULL,
  "space_id" integer NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "image_url" text NOT NULL,
  "created_by" integer NOT NULL REFERENCES "users"("id"),
  "created_at" integer NOT NULL DEFAULT extract(epoch from now())::int
);

CREATE UNIQUE INDEX "space_emoji_space_name_unique" ON "space_emoji" ("space_id", "name");

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema.pg.ts',
  out: './drizzle.pg',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://hum:hum@localhost:5432/hum',
  },
});

import { defineConfig } from 'drizzle-kit';

const isPg = !!process.env.DATABASE_URL;

export default defineConfig(isPg ? {
  schema: './src/schema.pg.ts',
  out: './drizzle.pg',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} : {
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DB_PATH ?? '../../hum.db',
  },
});

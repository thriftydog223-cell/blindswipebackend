import { defineConfig } from "drizzle-kit";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be set");
export default defineConfig({
  schema: "./lib/db/src/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL },
});

// This file is used by the Prisma CLI (e.g., db push, migrate).
// It uses the DIRECT_URL (port 5432) to bypass pgbouncer for migrations.
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DIRECT_URL"],
  },
});

#!/usr/bin/env node
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serve } from "./mcp.ts";
import { seed } from "./seed.ts";

const dbPath = process.env.DB_PATH ?? fileURLToPath(new URL("../demo.db", import.meta.url));
if (!existsSync(dbPath)) {
  if (process.env.DB_PATH) {
    console.error(`Database not found: ${dbPath}`);
    process.exit(1);
  }
  seed(dbPath); // first run: create the demo database
}
serve(dbPath);

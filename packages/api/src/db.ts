import { createDb } from "@copr-index/shared";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL && process.env.NODE_ENV !== "test") {
  throw new Error("DATABASE_URL environment variable is required");
}

export const db = DATABASE_URL ? createDb(DATABASE_URL) : (null as any);

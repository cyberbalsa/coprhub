import { eq, ilike } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

export function buildTextFilter(column: PgColumn, value: string | undefined) {
  if (!value) return undefined;
  if (value.includes("*")) {
    return ilike(column, value.replaceAll("*", "%"));
  }
  return eq(column, value);
}

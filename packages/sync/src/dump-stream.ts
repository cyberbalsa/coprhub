import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";

/**
 * Extract COPY sections from a pg_dump text string.
 * Returns an object mapping each requested table name to its data lines.
 */
export function extractCopySections(
  content: string,
  tableNames: string[],
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const name of tableNames) {
    result[name] = [];
  }

  const tableSet = new Set(tableNames);
  const lines = content.split("\n");
  let currentTable: string | null = null;

  for (const line of lines) {
    if (currentTable !== null) {
      if (line === "\\.") {
        currentTable = null;
      } else {
        result[currentTable].push(line);
      }
    } else {
      if (line.startsWith("COPY ")) {
        const tableName = line.split(" ")[1];
        if (tableSet.has(tableName)) {
          currentTable = tableName;
        }
      }
    }
  }

  return result;
}

/**
 * Stream-extract COPY sections from a pg_dump file (optionally gzipped).
 * Memory-efficient: only stores lines from requested tables.
 */
export async function streamExtractCopySections(
  filePath: string,
  tableNames: string[],
): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {};
  for (const name of tableNames) {
    result[name] = [];
  }

  const tableSet = new Set(tableNames);
  let currentTable: string | null = null;

  const fileStream = createReadStream(filePath);
  const input = filePath.endsWith(".gz")
    ? fileStream.pipe(createGunzip())
    : fileStream;

  const rl = createInterface({ input, crlfDelay: Infinity });

  for await (const line of rl) {
    if (currentTable !== null) {
      if (line === "\\.") {
        currentTable = null;
      } else {
        result[currentTable].push(line);
      }
    } else {
      if (line.startsWith("COPY ")) {
        const tableName = line.split(" ")[1];
        if (tableSet.has(tableName)) {
          currentTable = tableName;
        }
      }
    }
  }

  return result;
}

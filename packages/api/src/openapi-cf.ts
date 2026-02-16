/**
 * Convert an OpenAPI 3.1.0 spec to 3.0.0 for Cloudflare API Shield compatibility.
 * Deep-clones the input — does not mutate the original.
 */
export function convertToOas3_0(spec: Record<string, unknown>): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(spec));
  clone.openapi = "3.0.0";

  // CF does not support relative server URLs — filter them out
  if (Array.isArray(clone.servers)) {
    clone.servers = clone.servers.filter(
      (s: { url?: string }) => s.url && /^https?:\/\//.test(s.url),
    );
  }

  walkNode(clone);
  return clone;
}

function walkNode(node: unknown): void {
  if (node === null || typeof node !== "object") return;

  if (Array.isArray(node)) {
    for (const item of node) walkNode(item);
    return;
  }

  const obj = node as Record<string, unknown>;

  // Convert type: ["string", "null"] → type: "string", nullable: true
  if (Array.isArray(obj.type)) {
    const types = obj.type as unknown[];
    const nonNull = types.filter((t) => t !== "null");
    // Only convert single-type + null arrays; multi-type arrays (e.g. ["string", "integer"])
    // have no OAS 3.0 equivalent — leave unchanged rather than produce an invalid schema.
    if (nonNull.length === 1) {
      obj.type = nonNull[0];
      if (types.includes("null")) {
        obj.nullable = true;
      }
    }
  }

  // Convert examples: [val, ...] → example: val (first item)
  if (Array.isArray(obj.examples) && obj.examples.length > 0) {
    obj.example = obj.examples[0];
    delete obj.examples;
  }

  // Convert const: val → enum: [val]
  if ("const" in obj) {
    obj.enum = [obj.const];
    delete obj.const;
  }

  // Remove null from enum arrays (nullable already handled by type conversion)
  if (Array.isArray(obj.enum)) {
    obj.enum = (obj.enum as unknown[]).filter((v) => v !== null);
  }

  // Recurse into all object values
  for (const value of Object.values(obj)) {
    walkNode(value);
  }
}

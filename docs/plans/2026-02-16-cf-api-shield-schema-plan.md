# CF API Shield Schema Endpoint — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `GET /api/cf` endpoint that dynamically converts the existing OpenAPI 3.1.0 spec to CF-compatible 3.0.0.

**Architecture:** A pure `convertToOas3_0()` function deep-clones the spec and recursively walks the object tree, applying 3.1→3.0 transformations. A one-line route handler serves the result. No dependencies added.

**Tech Stack:** TypeScript, Hono, Vitest

---

### Task 1: Write failing tests for the converter function

**Files:**
- Create: `packages/api/src/openapi-cf.test.ts`

**Step 1: Write the test file**

```typescript
import { describe, it, expect } from "vitest";
import { convertToOas3_0 } from "./openapi-cf.js";
import { openApiSpec } from "./openapi.js";

describe("convertToOas3_0", () => {
  const converted = convertToOas3_0(openApiSpec);

  it("sets openapi version to 3.0.0", () => {
    expect(converted.openapi).toBe("3.0.0");
  });

  it("does not mutate the original spec", () => {
    expect(openApiSpec.openapi).toBe("3.1.0");
  });

  it("converts type arrays to nullable", () => {
    const desc = converted.components.schemas.ProjectSummary.properties.description;
    expect(desc.type).toBe("string");
    expect(desc.nullable).toBe(true);
  });

  it("converts integer nullable types", () => {
    const coprId = converted.components.schemas.ProjectSummary.properties.coprId;
    expect(coprId.type).toBe("integer");
    expect(coprId.nullable).toBe(true);
  });

  it("converts array nullable types", () => {
    const chroots = converted.components.schemas.ProjectDetail.properties.chroots;
    expect(chroots.type).toBe("array");
    expect(chroots.nullable).toBe(true);
  });

  it("converts examples (plural) to example (singular)", () => {
    const fullName = converted.components.schemas.ProjectSummary.properties.fullName;
    expect(fullName.example).toBe("atim/lazygit");
    expect(fullName.examples).toBeUndefined();
  });

  it("converts array-valued examples to first item", () => {
    const chroots = converted.components.schemas.ProjectDetail.properties.chroots;
    expect(chroots.example).toEqual(["fedora-40-x86_64", "fedora-41-x86_64"]);
    expect(chroots.examples).toBeUndefined();
  });

  it("removes null from enum arrays", () => {
    const provider = converted.components.schemas.ProjectSummary.properties.upstreamProvider;
    expect(provider.enum).toEqual(["github", "gitlab"]);
    expect(provider.nullable).toBe(true);
  });

  it("preserves $ref references unchanged", () => {
    const projectsPath = converted.paths["/api/projects"].get.responses["200"].content["application/json"].schema;
    expect(projectsPath.properties.data.items.$ref).toBe("#/components/schemas/ProjectSummary");
  });

  it("preserves non-nullable simple types", () => {
    const id = converted.components.schemas.ProjectSummary.properties.id;
    expect(id.type).toBe("integer");
    expect(id.nullable).toBeUndefined();
  });

  it("preserves all paths from original spec", () => {
    const originalPaths = Object.keys(openApiSpec.paths);
    const convertedPaths = Object.keys(converted.paths);
    expect(convertedPaths).toEqual(originalPaths);
  });

  it("preserves all component schemas from original spec", () => {
    const originalSchemas = Object.keys(openApiSpec.components.schemas);
    const convertedSchemas = Object.keys(converted.components.schemas);
    expect(convertedSchemas).toEqual(originalSchemas);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /home/balsa/Documents/Projects/copr-index && bun --filter @coprhub/api test`
Expected: FAIL — `convertToOas3_0` does not exist yet

---

### Task 2: Implement the converter function

**Files:**
- Create: `packages/api/src/openapi-cf.ts`

**Step 1: Write the converter**

```typescript
/**
 * Convert an OpenAPI 3.1.0 spec to 3.0.0 for Cloudflare API Shield compatibility.
 * Deep-clones the input — does not mutate the original.
 */
export function convertToOas3_0(spec: Record<string, unknown>): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(spec));
  clone.openapi = "3.0.0";
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
```

**Step 2: Run tests to verify they pass**

Run: `cd /home/balsa/Documents/Projects/copr-index && bun --filter @coprhub/api test`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add packages/api/src/openapi-cf.ts packages/api/src/openapi-cf.test.ts
git commit -m "feat(api): add OAS 3.1→3.0 converter for CF API Shield"
```

---

### Task 3: Register the /api/cf route and exclude from cache

**Files:**
- Modify: `packages/api/src/index.ts`

**Step 1: Add the route and cache exclusion**

In `packages/api/src/index.ts`, add the import and route:

```typescript
// Add import at top (after openapi.js import):
import { convertToOas3_0 } from "./openapi-cf.js";

// Add route after the existing /api/openapi.json line:
app.get("/api/cf", (c) => c.json(convertToOas3_0(openApiSpec)));
```

Update the cache excludePaths to include `/api/cf`:

```typescript
excludePaths: ["/api/health", "/api/openapi.json", "/api/cf"],
```

**Step 2: Write the endpoint integration test**

Add to `packages/api/src/openapi-cf.test.ts`:

```typescript
import { app } from "./index.js";

describe("GET /api/cf", () => {
  it("returns a valid OAS 3.0.0 spec", async () => {
    const res = await app.request("/api/cf");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.openapi).toBe("3.0.0");
    expect(body.info.title).toBe("COPRHub API");
    expect(body.paths["/api/projects"]).toBeDefined();
  });
});
```

**Step 3: Run all tests**

Run: `cd /home/balsa/Documents/Projects/copr-index && bun --filter @coprhub/api test`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add packages/api/src/index.ts packages/api/src/openapi-cf.test.ts
git commit -m "feat(api): serve CF-compatible OAS 3.0 schema at /api/cf"
```

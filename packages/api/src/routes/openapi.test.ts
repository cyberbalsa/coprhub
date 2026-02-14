import { describe, it, expect } from "vitest";
import { app } from "../index.js";

describe("OpenAPI", () => {
  it("GET /api/openapi.json returns OpenAPI 3.1.0 spec", async () => {
    const res = await app.request("/api/openapi.json");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.openapi).toBe("3.1.0");
    expect(body.info.title).toBe("COPR Index API");
    expect(body.paths["/api/projects"]).toBeDefined();
    expect(body.paths["/api/health"]).toBeDefined();
    expect(body.components.schemas.ProjectSummary).toBeDefined();
  });

  it("GET /api serves Swagger UI HTML", async () => {
    const res = await app.request("/api");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("swagger-ui");
  });
});

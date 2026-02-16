import { describe, it, expect } from "vitest";
import { convertToOas3_0 } from "./openapi-cf.js";
import { openApiSpec } from "./openapi.js";

describe("convertToOas3_0", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deep structural assertions on generic JSON
  const converted = convertToOas3_0(openApiSpec) as any;

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

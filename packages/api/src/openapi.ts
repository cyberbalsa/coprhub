export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "COPRHub API",
    version: "0.1.0",
    description:
      "REST API for COPRHub — a Flathub-style web store for Fedora COPR repositories. Browse, search, and discover community-built RPM packages with upstream GitHub/GitLab star counts.",
    license: {
      name: "MIT",
    },
  },
  servers: [
    {
      url: "/",
      description: "Current server",
    },
    {
      url: "https://api.coprhub.org",
      description: "Production",
    },
  ],
  tags: [
    { name: "Projects", description: "COPR project listing, search, and detail" },
    { name: "Categories", description: "Project category browsing" },
    { name: "Stats", description: "Aggregate statistics" },
    { name: "Health", description: "Service health check" },
  ],
  paths: {
    "/api/projects": {
      get: {
        tags: ["Projects"],
        summary: "List and search projects",
        description:
          "Returns a paginated list of COPR projects. Supports full-text search, filtering by owner/language/category, and sorting by stars, name, or update date.",
        parameters: [
          {
            name: "q",
            in: "query",
            description: "Full-text search query (uses PostgreSQL tsquery)",
            schema: { type: "string" },
          },
          {
            name: "sort",
            in: "query",
            description: "Sort field",
            schema: { type: "string", enum: ["stars", "name", "updated"], default: "stars" },
          },
          {
            name: "order",
            in: "query",
            description: "Sort direction",
            schema: { type: "string", enum: ["asc", "desc"], default: "desc" },
          },
          {
            name: "category",
            in: "query",
            description: "Filter by category slug",
            schema: { type: "string" },
          },
          {
            name: "owner",
            in: "query",
            description: "Filter by COPR owner username",
            schema: { type: "string" },
          },
          {
            name: "language",
            in: "query",
            description: "Filter by upstream primary language",
            schema: { type: "string" },
          },
          {
            name: "page",
            in: "query",
            description: "Page number",
            schema: { type: "integer", default: 1, minimum: 1 },
          },
          {
            name: "limit",
            in: "query",
            description: "Results per page (max 100)",
            schema: { type: "integer", default: 24, minimum: 1, maximum: 100 },
          },
        ],
        responses: {
          "200": {
            description: "Paginated list of projects",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "array",
                      items: { $ref: "#/components/schemas/ProjectSummary" },
                    },
                    meta: { $ref: "#/components/schemas/PaginationMeta" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/projects/{owner}/{name}": {
      get: {
        tags: ["Projects"],
        summary: "Get project detail",
        description: "Returns full details for a single COPR project.",
        parameters: [
          {
            name: "owner",
            in: "path",
            required: true,
            description: "COPR owner username or @group",
            schema: { type: "string" },
          },
          {
            name: "name",
            in: "path",
            required: true,
            description: "COPR project name",
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Project detail",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ProjectDetail" },
              },
            },
          },
          "404": {
            description: "Project not found",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
    "/api/projects/{owner}/{name}/packages": {
      get: {
        tags: ["Projects"],
        summary: "List packages for a project",
        description: "Returns all RPM packages belonging to a COPR project.",
        parameters: [
          {
            name: "owner",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "name",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Package list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "array",
                      items: { $ref: "#/components/schemas/PackageInfo" },
                    },
                  },
                },
              },
            },
          },
          "404": {
            description: "Project not found",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
    "/api/categories": {
      get: {
        tags: ["Categories"],
        summary: "List all categories",
        description: "Returns all categories with their project counts.",
        responses: {
          "200": {
            description: "Category list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "array",
                      items: { $ref: "#/components/schemas/CategoryWithCount" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/categories/{slug}": {
      get: {
        tags: ["Categories"],
        summary: "List projects in a category",
        description: "Returns projects belonging to the specified category, sorted by upstream stars.",
        parameters: [
          {
            name: "slug",
            in: "path",
            required: true,
            description: "Category URL slug",
            schema: { type: "string" },
          },
          {
            name: "page",
            in: "query",
            schema: { type: "integer", default: 1, minimum: 1 },
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", default: 24, minimum: 1, maximum: 100 },
          },
        ],
        responses: {
          "200": {
            description: "Projects in category",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "array",
                      items: { $ref: "#/components/schemas/ProjectSummary" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/stats": {
      get: {
        tags: ["Stats"],
        summary: "Get aggregate statistics",
        description: "Returns total project counts and top programming languages.",
        responses: {
          "200": {
            description: "Aggregate stats",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/StatsResponse" },
              },
            },
          },
        },
      },
    },
    "/api/health": {
      get: {
        tags: ["Health"],
        summary: "Health check",
        description: "Returns service status and timestamp.",
        responses: {
          "200": {
            description: "Service is healthy",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", enum: ["ok"] },
                    timestamp: { type: "string", format: "date-time" },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      ProjectSummary: {
        type: "object",
        properties: {
          id: { type: "integer" },
          fullName: { type: "string", examples: ["atim/lazygit"] },
          owner: { type: "string", examples: ["atim"] },
          name: { type: "string", examples: ["lazygit"] },
          description: { type: ["string", "null"] },
          upstreamUrl: { type: ["string", "null"], format: "uri" },
          upstreamProvider: {
            type: ["string", "null"],
            enum: ["github", "gitlab", null],
          },
          upstreamStars: { type: "integer", examples: [42000] },
          upstreamLanguage: { type: ["string", "null"], examples: ["Go"] },
        },
      },
      ProjectDetail: {
        type: "object",
        allOf: [{ $ref: "#/components/schemas/ProjectSummary" }],
        properties: {
          instructions: { type: ["string", "null"] },
          homepage: { type: ["string", "null"], format: "uri" },
          chroots: {
            type: ["array", "null"],
            items: { type: "string" },
            examples: [["fedora-40-x86_64", "fedora-41-x86_64"]],
          },
          repoUrl: { type: ["string", "null"], format: "uri" },
          upstreamForks: { type: "integer" },
          upstreamDescription: { type: ["string", "null"] },
          upstreamTopics: {
            type: ["array", "null"],
            items: { type: "string" },
          },
          lastSyncedAt: { type: ["string", "null"], format: "date-time" },
          createdAt: { type: ["string", "null"], format: "date-time" },
        },
      },
      PackageInfo: {
        type: "object",
        properties: {
          id: { type: "integer" },
          name: { type: "string", examples: ["lazygit"] },
          sourceType: { type: ["string", "null"], examples: ["scm"] },
          sourceUrl: { type: ["string", "null"], format: "uri" },
        },
      },
      CategoryWithCount: {
        type: "object",
        properties: {
          id: { type: "integer" },
          slug: { type: "string", examples: ["development-tools"] },
          name: { type: "string", examples: ["Development Tools"] },
          projectCount: { type: "integer" },
        },
      },
      StatsResponse: {
        type: "object",
        properties: {
          totalProjects: { type: "integer" },
          totalWithUpstream: { type: "integer" },
          topLanguages: {
            type: "array",
            items: {
              type: "object",
              properties: {
                language: { type: "string" },
                count: { type: "integer" },
              },
            },
          },
        },
      },
      PaginationMeta: {
        type: "object",
        properties: {
          page: { type: "integer" },
          limit: { type: "integer" },
          total: { type: "integer" },
          pages: { type: "integer" },
        },
      },
      Error: {
        type: "object",
        properties: {
          error: { type: "string" },
        },
      },
    },
  },
};

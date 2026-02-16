import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { swaggerUI } from "@hono/swagger-ui";
import { createHealthRouter } from "./routes/health.js";
import { createProjectsRouter } from "./routes/projects.js";
import { createCategoriesRouter } from "./routes/categories.js";
import { createStatsRouter } from "./routes/stats.js";
import { openApiSpec } from "./openapi.js";
import { db } from "./db.js";

export const app = new Hono();

app.use("*", logger());
app.use("*", cors());

// OpenAPI spec and Swagger UI
app.get("/api/openapi.json", (c) => c.json(openApiSpec));
app.get("/api", swaggerUI({ url: "/api/openapi.json" }));

app.route("/api/health", createHealthRouter(db));
app.route("/api/projects", createProjectsRouter(db));
app.route("/api/categories", createCategoriesRouter(db));
app.route("/api/stats", createStatsRouter(db));

if (process.env.NODE_ENV !== "test") {
  const { serve } = await import("@hono/node-server");
  const port = parseInt(process.env.PORT || "4000", 10);
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`API server running on http://localhost:${info.port}`);
  });
}

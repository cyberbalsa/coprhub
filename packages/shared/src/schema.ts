import {
  pgTable,
  serial,
  text,
  integer,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const projects = pgTable(
  "projects",
  {
    id: serial("id").primaryKey(),
    coprId: integer("copr_id").unique(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    fullName: text("full_name").unique().notNull(),
    description: text("description"),
    instructions: text("instructions"),
    homepage: text("homepage"),
    chroots: jsonb("chroots").$type<string[]>(),
    repoUrl: text("repo_url"),
    upstreamUrl: text("upstream_url"),
    upstreamProvider: text("upstream_provider").$type<"github" | "gitlab" | null>(),
    upstreamStars: integer("upstream_stars").default(0),
    upstreamForks: integer("upstream_forks").default(0),
    upstreamDescription: text("upstream_description"),
    upstreamLanguage: text("upstream_language"),
    upstreamTopics: jsonb("upstream_topics").$type<string[]>(),
    upstreamReadme: text("upstream_readme"),
    coprVotes: integer("copr_votes").default(0),
    coprDownloads: integer("copr_downloads").default(0),
    coprRepoEnables: integer("copr_repo_enables").default(0),
    discourseTopicId: integer("discourse_topic_id"),
    discourseLikes: integer("discourse_likes").default(0),
    discourseViews: integer("discourse_views").default(0),
    discourseReplies: integer("discourse_replies").default(0),
    popularityScore: integer("popularity_score").default(0),
    readmeSyncedAt: timestamp("readme_synced_at"),
    votesSyncedAt: timestamp("votes_synced_at"),
    searchVector: text("search_vector"),
    lastSyncedAt: timestamp("last_synced_at"),
    starsSyncedAt: timestamp("stars_synced_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("projects_owner_name_idx").on(table.owner, table.name),
    index("projects_upstream_stars_idx").on(table.upstreamStars),
    index("projects_full_name_idx").on(table.fullName),
    index("projects_owner_idx").on(table.owner),
    index("projects_updated_at_idx").on(table.updatedAt),
    index("projects_popularity_score_idx").on(table.popularityScore),
  ]
);

export const packages = pgTable("packages", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .references(() => projects.id, { onDelete: "cascade" })
    .notNull(),
  name: text("name").notNull(),
  sourceType: text("source_type"),
  sourceUrl: text("source_url"),
});

export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  slug: text("slug").unique().notNull(),
  name: text("name").notNull(),
});

export const projectCategories = pgTable(
  "project_categories",
  {
    projectId: integer("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    categoryId: integer("category_id")
      .references(() => categories.id, { onDelete: "cascade" })
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.categoryId] })]
);

import { sql } from "drizzle-orm";
import {
	check,
	doublePrecision,
	index,
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
	vector,
} from "drizzle-orm/pg-core";

export const promptClusterStatus = pgEnum("prompt_cluster_status", [
	"active",
	"hidden",
]);

export const answerStatus = pgEnum("answer_status", [
	"active",
	"hidden",
	"rejected",
]);

export const reportStatus = pgEnum("report_status", [
	"open",
	"reviewed",
	"dismissed",
]);

export const embeddingUsage = pgEnum("embedding_usage", ["prompt", "answer"]);

export const promptClusters = pgTable(
	"prompt_clusters",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		representativePrompt: text("representative_prompt").notNull(),
		embedding: vector("embedding", { dimensions: 384 }).notNull(),
		promptCount: integer("prompt_count").notNull().default(0),
		answerCount: integer("answer_count").notNull().default(0),
		status: promptClusterStatus("status").notNull().default("active"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		index("prompt_clusters_embedding_hnsw_idx").using(
			"hnsw",
			table.embedding.op("vector_cosine_ops"),
		),
	],
);

export const prompts = pgTable(
	"prompts",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		text: text("text").notNull(),
		normalizedText: text("normalized_text").notNull(),
		embedding: vector("embedding", { dimensions: 384 }).notNull(),
		clusterId: uuid("cluster_id")
			.notNull()
			.references(() => promptClusters.id, { onDelete: "restrict" }),
		matchedSimilarity: doublePrecision("matched_similarity"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		index("prompts_cluster_id_idx").on(table.clusterId),
		index("prompts_normalized_text_idx").on(table.normalizedText),
	],
);

export const answers = pgTable(
	"answers",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		clusterId: uuid("cluster_id")
			.notNull()
			.references(() => promptClusters.id, { onDelete: "restrict" }),
		text: text("text").notNull(),
		normalizedText: text("normalized_text").notNull(),
		embedding: vector("embedding", { dimensions: 384 }).notNull(),
		status: answerStatus("status").notNull().default("active"),
		reportCount: integer("report_count").notNull().default(0),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		index("answers_embedding_hnsw_idx").using(
			"hnsw",
			table.embedding.op("vector_cosine_ops"),
		),
		index("answers_cluster_id_status_idx").on(table.clusterId, table.status),
		index("answers_normalized_text_idx").on(table.normalizedText),
	],
);

export const reports = pgTable(
	"reports",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		answerId: uuid("answer_id")
			.notNull()
			.references(() => answers.id, { onDelete: "cascade" }),
		reason: text("reason").notNull(),
		status: reportStatus("status").notNull().default("open"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [index("reports_answer_id_idx").on(table.answerId)],
);

export const embeddingCache = pgTable(
	"embedding_cache",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		usage: embeddingUsage("usage").notNull(),
		normalizedText: text("normalized_text").notNull(),
		embedding: vector("embedding", { dimensions: 384 }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		uniqueIndex("embedding_cache_usage_normalized_text_idx").on(
			table.usage,
			table.normalizedText,
		),
		index("embedding_cache_embedding_hnsw_idx").using(
			"hnsw",
			table.embedding.op("vector_cosine_ops"),
		),
		check(
			"embedding_cache_usage_check",
			sql`${table.usage} in ('prompt', 'answer')`,
		),
	],
);

CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint
CREATE TYPE "public"."answer_status" AS ENUM('active', 'hidden', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."embedding_usage" AS ENUM('prompt', 'answer');--> statement-breakpoint
CREATE TYPE "public"."prompt_cluster_status" AS ENUM('active', 'hidden');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('open', 'reviewed', 'dismissed');--> statement-breakpoint
CREATE TABLE "answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cluster_id" uuid NOT NULL,
	"text" text NOT NULL,
	"normalized_text" text NOT NULL,
	"embedding" vector(384) NOT NULL,
	"status" "answer_status" DEFAULT 'active' NOT NULL,
	"report_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "embedding_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usage" "embedding_usage" NOT NULL,
	"normalized_text" text NOT NULL,
	"embedding" vector(384) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "embedding_cache_usage_check" CHECK ("embedding_cache"."usage" in ('prompt', 'answer'))
);
--> statement-breakpoint
CREATE TABLE "prompt_clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"representative_prompt" text NOT NULL,
	"embedding" vector(384) NOT NULL,
	"prompt_count" integer DEFAULT 0 NOT NULL,
	"answer_count" integer DEFAULT 0 NOT NULL,
	"status" "prompt_cluster_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text" text NOT NULL,
	"normalized_text" text NOT NULL,
	"embedding" vector(384) NOT NULL,
	"cluster_id" uuid NOT NULL,
	"matched_similarity" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"answer_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" "report_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_cluster_id_prompt_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."prompt_clusters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_cluster_id_prompt_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."prompt_clusters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_answer_id_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."answers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "answers_embedding_hnsw_idx" ON "answers" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "answers_cluster_id_status_idx" ON "answers" USING btree ("cluster_id","status");--> statement-breakpoint
CREATE INDEX "answers_normalized_text_idx" ON "answers" USING btree ("normalized_text");--> statement-breakpoint
CREATE UNIQUE INDEX "embedding_cache_usage_normalized_text_idx" ON "embedding_cache" USING btree ("usage","normalized_text");--> statement-breakpoint
CREATE INDEX "embedding_cache_embedding_hnsw_idx" ON "embedding_cache" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "prompt_clusters_embedding_hnsw_idx" ON "prompt_clusters" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "prompts_cluster_id_idx" ON "prompts" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX "prompts_normalized_text_idx" ON "prompts" USING btree ("normalized_text");--> statement-breakpoint
CREATE INDEX "reports_answer_id_idx" ON "reports" USING btree ("answer_id");

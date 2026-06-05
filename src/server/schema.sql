create extension if not exists vector;
create extension if not exists pgcrypto;

do $$ begin
	create type prompt_cluster_status as enum ('active', 'hidden');
exception
	when duplicate_object then null;
end $$;

do $$ begin
	create type answer_status as enum ('active', 'hidden', 'rejected');
exception
	when duplicate_object then null;
end $$;

do $$ begin
	create type report_status as enum ('open', 'reviewed', 'dismissed');
exception
	when duplicate_object then null;
end $$;

create table if not exists prompt_clusters (
	id uuid primary key default gen_random_uuid(),
	representative_prompt text not null,
	embedding vector(1536) not null,
	prompt_count integer not null default 0,
	answer_count integer not null default 0,
	status prompt_cluster_status not null default 'active',
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create table if not exists prompts (
	id uuid primary key default gen_random_uuid(),
	text text not null,
	normalized_text text not null,
	embedding vector(1536) not null,
	cluster_id uuid not null references prompt_clusters(id) on delete restrict,
	matched_similarity double precision,
	created_at timestamptz not null default now()
);

create table if not exists answers (
	id uuid primary key default gen_random_uuid(),
	cluster_id uuid not null references prompt_clusters(id) on delete restrict,
	text text not null,
	normalized_text text not null,
	embedding vector(1536) not null,
	status answer_status not null default 'active',
	report_count integer not null default 0,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create table if not exists reports (
	id uuid primary key default gen_random_uuid(),
	answer_id uuid not null references answers(id) on delete cascade,
	reason text not null,
	status report_status not null default 'open',
	created_at timestamptz not null default now()
);

create index if not exists prompt_clusters_embedding_hnsw_idx
	on prompt_clusters using hnsw (embedding vector_cosine_ops);

create index if not exists answers_embedding_hnsw_idx
	on answers using hnsw (embedding vector_cosine_ops);

create index if not exists prompts_cluster_id_idx on prompts(cluster_id);
create index if not exists answers_cluster_id_status_idx on answers(cluster_id, status);
create index if not exists reports_answer_id_idx on reports(answer_id);

import { type SQL, sql } from "drizzle-orm";
import type { Pool } from "pg";
import type { AppDb } from "./db";
import { createDb, getDb } from "./db";
import type { EmbedText } from "./embedding";
import {
	averageEmbedding,
	embedText,
	fromVectorLiteral,
	toVectorLiteral,
} from "./embedding";

export type AskArchiveInput = {
	prompt: string;
	excludeAnswerIds?: Array<string>;
};

export type AskArchiveResult =
	| {
			type: "answer";
			promptId: string;
			answer: PublicAnswer;
			matchScore: number;
	  }
	| {
			type: "no_answer";
			prompt: string;
	  }
	| {
			type: "safety";
			message: string;
	  };

export type LeaveAnswerInput = {
	prompt: string;
	answer: string;
};

export type LeaveAnswerResult =
	| {
			type: "created";
			promptId: string;
			answer: PublicAnswer;
	  }
	| {
			type: "already_there";
	  }
	| {
			type: "rejected";
			reason: ModerationReason;
	  };

export type PublicAnswer = {
	id: string;
	text: string;
};

export type ReportReason =
	| "spam"
	| "abuse"
	| "private_info"
	| "dangerous"
	| "other";

export type ModerationReason =
	| "empty"
	| "too_long"
	| "spam"
	| "abuse"
	| "private_info"
	| "dangerous";

type ArchiveDependencies = {
	pool?: Pool;
	embed?: EmbedText;
	random?: () => number;
};

type DbExecutor = {
	execute: (query: SQL) => Promise<{ rows: Array<unknown> }>;
};

type EmbeddingUsage = "prompt" | "answer";

type ClusterMatch = {
	id: string;
	representativePrompt: string;
	embedding: Array<number>;
	promptCount: number;
	similarity: number;
};

type ClusterRow = {
	id: string;
	representative_prompt: string;
	embedding: string;
	prompt_count: number;
	similarity: number;
};

type AnswerRow = {
	id: string;
	text: string;
	report_count: number;
};

const MATCH_THRESHOLD = 0.78;
const DUPLICATE_THRESHOLD = 0.92;
const REPORT_HIDE_THRESHOLD = 3;
const MAX_PROMPT_LENGTH = 500;
const MAX_ANSWER_LENGTH = 1_000;

const DANGEROUS_PATTERNS = [
	/\bbuild\s+(a\s+)?bomb\b/i,
	/\bmake\s+(a\s+)?bomb\b/i,
	/\bpoison\b/i,
	/\bhotwire\b/i,
	/\bsteal\b/i,
	/\bkill\s+(someone|myself|yourself|them|him|her)\b/i,
];

const PRIVATE_INFO_PATTERNS = [
	/\b\d{3}-\d{2}-\d{4}\b/,
	/\b(?:\d[ -]*?){13,16}\b/,
	/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
	/\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/,
];

const ABUSE_PATTERNS = [
	/\b(kys|kill yourself)\b/i,
	/\b(faggot|nigger|retard)\b/i,
];

const SPAM_PATTERNS = [
	/\bhttps?:\/\//i,
	/\bcasino\b/i,
	/\bcrypto\s+(airdrop|giveaway)\b/i,
	/\bfree\s+money\b/i,
];

export async function askArchive(
	input: AskArchiveInput,
	dependencies: ArchiveDependencies = {},
): Promise<AskArchiveResult> {
	const prompt = cleanText(input.prompt);
	if (isSafetyPrompt(prompt)) {
		return {
			type: "safety",
			message:
				"This needs help from someone who can act now. Contact local emergency services or a crisis line.",
		};
	}

	const moderation = moderateText(prompt, MAX_PROMPT_LENGTH);
	if (moderation) {
		return { type: "no_answer", prompt };
	}

	const db = await readyDb(dependencies.pool);
	const random = dependencies.random ?? Math.random;

	return db.transaction(async (client) => {
		const embedding = await getCachedEmbedding(client, {
			usage: "prompt",
			text: prompt,
			embed: dependencies.embed ?? embedText,
		});
		const cluster = await findOrCreateCluster(client, prompt, embedding);
		const promptId = await insertPrompt(client, {
			text: prompt,
			embedding,
			clusterId: cluster.id,
			matchedSimilarity: cluster.similarity,
		});

		await updateClusterForPrompt(client, cluster, embedding);

		const answer =
			(await pickAnswer(
				client,
				cluster.id,
				input.excludeAnswerIds ?? [],
				random,
			)) ?? (await pickAnswer(client, cluster.id, [], random));

		if (!answer || cluster.similarity < MATCH_THRESHOLD) {
			return {
				type: "no_answer",
				prompt,
			};
		}

		return {
			type: "answer",
			promptId,
			answer,
			matchScore: roundScore(cluster.similarity),
		};
	});
}

export async function leaveAnswer(
	input: LeaveAnswerInput,
	dependencies: ArchiveDependencies = {},
): Promise<LeaveAnswerResult> {
	const prompt = cleanText(input.prompt);
	const answer = cleanText(input.answer);
	const promptModeration = moderateText(prompt, MAX_PROMPT_LENGTH);
	if (promptModeration) {
		return { type: "rejected", reason: promptModeration };
	}

	const answerModeration = moderateText(answer, MAX_ANSWER_LENGTH);
	if (answerModeration) {
		return { type: "rejected", reason: answerModeration };
	}

	const db = await readyDb(dependencies.pool);
	const embed = dependencies.embed ?? embedText;

	return db.transaction(async (client) => {
		const promptEmbedding = await getCachedEmbedding(client, {
			usage: "prompt",
			text: prompt,
			embed,
		});
		const answerEmbedding = await getCachedEmbedding(client, {
			usage: "answer",
			text: answer,
			embed,
		});
		const cluster = await findOrCreateCluster(client, prompt, promptEmbedding);
		const promptId = await insertPrompt(client, {
			text: prompt,
			embedding: promptEmbedding,
			clusterId: cluster.id,
			matchedSimilarity: cluster.similarity,
		});

		await updateClusterForPrompt(client, cluster, promptEmbedding);

		const duplicate = await hasDuplicateAnswer(client, {
			clusterId: cluster.id,
			answer,
			embedding: answerEmbedding,
		});

		if (duplicate) {
			return { type: "already_there" };
		}

		const created = await client.execute(sql<AnswerRow>`
				insert into answers (cluster_id, text, normalized_text, embedding)
				values (
					${cluster.id},
					${answer},
					${normalizeText(answer)},
					${toVectorLiteral(answerEmbedding)}::vector
				)
				returning id, text, report_count
		`);

		await client.execute(sql`
				update prompt_clusters
				set answer_count = answer_count + 1,
					updated_at = now()
				where id = ${cluster.id}
		`);

		const row = firstRow<AnswerRow>(created);
		if (!row) {
			throw new Error("Answer insert failed");
		}

		return {
			type: "created",
			promptId,
			answer: {
				id: row.id,
				text: row.text,
			},
		};
	});
}

export async function reportAnswer(
	answerId: string,
	reason: ReportReason,
	dependencies: Pick<ArchiveDependencies, "pool"> = {},
): Promise<{ ok: true; hidden: boolean } | { ok: false; reason: "not_found" }> {
	const db = await readyDb(dependencies.pool);

	return db.transaction(async (client) => {
		const answer = await client.execute(sql<{
			id: string;
			cluster_id: string;
			report_count: number;
			status: string;
		}>`
				select id, cluster_id, report_count, status
				from answers
				where id = ${answerId}
				for update
		`);

		const row = firstRow<{
			id: string;
			cluster_id: string;
			report_count: number;
			status: string;
		}>(answer);
		if (!row) {
			return { ok: false, reason: "not_found" };
		}

		await client.execute(sql`
				insert into reports (answer_id, reason)
				values (${answerId}, ${reason})
		`);

		const nextReportCount = row.report_count + 1;
		const hidden =
			row.status !== "hidden" && nextReportCount >= REPORT_HIDE_THRESHOLD;
		await client.execute(sql`
				update answers
				set report_count = ${nextReportCount},
					status = case when ${hidden} then 'hidden'::answer_status else status end,
					updated_at = now()
				where id = ${answerId}
		`);

		if (hidden) {
			await client.execute(sql`
					update prompt_clusters
					set answer_count = greatest(0, answer_count - 1),
						updated_at = now()
					where id = ${row.cluster_id}
			`);
		}

		return { ok: true, hidden: row.status === "hidden" || hidden };
	});
}

export async function getArchiveStats(
	dependencies: Pick<ArchiveDependencies, "pool"> = {},
) {
	const db = await readyDb(dependencies.pool);
	const result = await db.execute(sql<{
		prompt_count: string;
		cluster_count: string;
		answer_count: string;
		hidden_answer_count: string;
		report_count: string;
	}>`
			select
				(select count(*) from prompts) as prompt_count,
				(select count(*) from prompt_clusters) as cluster_count,
				(select count(*) from answers where status = 'active') as answer_count,
				(select count(*) from answers where status = 'hidden') as hidden_answer_count,
				(select count(*) from reports) as report_count
	`);

	const row = firstRow<{
		prompt_count: string;
		cluster_count: string;
		answer_count: string;
		hidden_answer_count: string;
		report_count: string;
	}>(result);
	return {
		promptCount: Number(row?.prompt_count ?? 0),
		clusterCount: Number(row?.cluster_count ?? 0),
		answerCount: Number(row?.answer_count ?? 0),
		hiddenAnswerCount: Number(row?.hidden_answer_count ?? 0),
		reportCount: Number(row?.report_count ?? 0),
	};
}

export function normalizeText(text: string): string {
	return text
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.replace(/\s+/g, " ");
}

export function moderateText(
	text: string,
	maxLength = MAX_ANSWER_LENGTH,
): ModerationReason | undefined {
	const cleaned = cleanText(text);
	if (!cleaned) {
		return "empty";
	}
	if (cleaned.length > maxLength) {
		return "too_long";
	}
	if (SPAM_PATTERNS.some((pattern) => pattern.test(cleaned))) {
		return "spam";
	}
	if (ABUSE_PATTERNS.some((pattern) => pattern.test(cleaned))) {
		return "abuse";
	}
	if (PRIVATE_INFO_PATTERNS.some((pattern) => pattern.test(cleaned))) {
		return "private_info";
	}
	if (DANGEROUS_PATTERNS.some((pattern) => pattern.test(cleaned))) {
		return "dangerous";
	}
	return undefined;
}

async function readyDb(pool: Pool | undefined): Promise<AppDb> {
	if (pool) {
		return createDb(pool);
	}
	return getDb();
}

async function findOrCreateCluster(
	client: DbExecutor,
	text: string,
	embedding: Array<number>,
): Promise<ClusterMatch> {
	const vector = toVectorLiteral(embedding);
	const match = await client.execute(sql<ClusterRow>`
			select
				id,
				representative_prompt,
				embedding::text,
				prompt_count,
				1 - (embedding <=> ${vector}::vector) as similarity
			from prompt_clusters
			where status = 'active'
			order by embedding <=> ${vector}::vector
			limit 1
	`);

	const row = firstRow<ClusterRow>(match);
	if (row && row.similarity >= MATCH_THRESHOLD) {
		return {
			id: row.id,
			representativePrompt: row.representative_prompt,
			embedding: fromVectorLiteral(row.embedding),
			promptCount: row.prompt_count,
			similarity: row.similarity,
		};
	}

	const created = await client.execute(sql<ClusterRow>`
			insert into prompt_clusters (
				representative_prompt,
				embedding,
				prompt_count,
				answer_count
			)
			values (${text}, ${vector}::vector, 0, 0)
			returning
				id,
				representative_prompt,
				embedding::text,
				prompt_count,
				1::double precision as similarity
	`);

	const createdRow = firstRow<ClusterRow>(created);
	if (!createdRow) {
		throw new Error("Prompt cluster insert failed");
	}

	return {
		id: createdRow.id,
		representativePrompt: createdRow.representative_prompt,
		embedding: fromVectorLiteral(createdRow.embedding),
		promptCount: createdRow.prompt_count,
		similarity: 1,
	};
}

async function getCachedEmbedding(
	client: DbExecutor,
	input: {
		usage: EmbeddingUsage;
		text: string;
		embed: EmbedText;
	},
): Promise<Array<number>> {
	const normalizedText = normalizeText(input.text);
	const cached = await client.execute(sql<{ embedding: string }>`
			select embedding::text
			from embedding_cache
			where usage = ${input.usage}
				and normalized_text = ${normalizedText}
			limit 1
	`);

	const cachedRow = firstRow<{ embedding: string }>(cached);
	if (cachedRow) {
		return fromVectorLiteral(cachedRow.embedding);
	}

	const existing =
		input.usage === "prompt"
			? await findExistingPromptEmbedding(client, normalizedText)
			: await findExistingAnswerEmbedding(client, normalizedText);

	if (existing) {
		await cacheEmbedding(client, input.usage, normalizedText, existing);
		return existing;
	}

	const embedding = await input.embed(input.text);
	await cacheEmbedding(client, input.usage, normalizedText, embedding);
	return embedding;
}

async function findExistingPromptEmbedding(
	client: DbExecutor,
	normalizedText: string,
): Promise<Array<number> | undefined> {
	const result = await client.execute(sql<{ embedding: string }>`
			select embedding::text
			from prompts
			where normalized_text = ${normalizedText}
			order by created_at desc
			limit 1
	`);

	const row = firstRow<{ embedding: string }>(result);
	return row ? fromVectorLiteral(row.embedding) : undefined;
}

async function findExistingAnswerEmbedding(
	client: DbExecutor,
	normalizedText: string,
): Promise<Array<number> | undefined> {
	const result = await client.execute(sql<{ embedding: string }>`
			select embedding::text
			from answers
			where normalized_text = ${normalizedText}
			order by created_at desc
			limit 1
	`);

	const row = firstRow<{ embedding: string }>(result);
	return row ? fromVectorLiteral(row.embedding) : undefined;
}

async function cacheEmbedding(
	client: DbExecutor,
	usage: EmbeddingUsage,
	normalizedText: string,
	embedding: Array<number>,
): Promise<void> {
	await client.execute(sql`
			insert into embedding_cache (usage, normalized_text, embedding)
			values (${usage}, ${normalizedText}, ${toVectorLiteral(embedding)}::vector)
			on conflict (usage, normalized_text) do nothing
	`);
}

async function insertPrompt(
	client: DbExecutor,
	input: {
		text: string;
		embedding: Array<number>;
		clusterId: string;
		matchedSimilarity: number;
	},
): Promise<string> {
	const result = await client.execute(sql<{ id: string }>`
			insert into prompts (
				text,
				normalized_text,
				embedding,
				cluster_id,
				matched_similarity
			)
			values (
				${input.text},
				${normalizeText(input.text)},
				${toVectorLiteral(input.embedding)}::vector,
				${input.clusterId},
				${roundScore(input.matchedSimilarity)}
			)
			returning id
	`);

	const row = firstRow<{ id: string }>(result);
	if (!row) {
		throw new Error("Prompt insert failed");
	}

	return row.id;
}

async function updateClusterForPrompt(
	client: DbExecutor,
	cluster: ClusterMatch,
	embedding: Array<number>,
): Promise<void> {
	const nextEmbedding = averageEmbedding(
		cluster.embedding,
		embedding,
		cluster.promptCount,
	);
	await client.execute(sql`
			update prompt_clusters
			set embedding = ${toVectorLiteral(nextEmbedding)}::vector,
				prompt_count = prompt_count + 1,
				updated_at = now()
			where id = ${cluster.id}
	`);
}

async function pickAnswer(
	client: DbExecutor,
	clusterId: string,
	excludeAnswerIds: Array<string>,
	random: () => number,
): Promise<PublicAnswer | undefined> {
	const excludedAnswerIds = uuidArrayLiteral(excludeAnswerIds);
	const result = await client.execute(sql<AnswerRow>`
			select id, text, report_count
			from answers
			where cluster_id = ${clusterId}
				and status = 'active'
				and not (id = any(${excludedAnswerIds}::uuid[]))
			order by created_at asc
	`);

	const row = pickWeightedAnswer(allRows<AnswerRow>(result), random);
	if (!row) {
		return undefined;
	}

	return {
		id: row.id,
		text: row.text,
	};
}

function pickWeightedAnswer(
	answers: Array<AnswerRow>,
	random: () => number,
): AnswerRow | undefined {
	if (answers.length === 0) {
		return undefined;
	}

	const totalWeight = answers.reduce(
		(total, answer) => total + Math.max(1, 10 - answer.report_count * 2),
		0,
	);
	let cursor = random() * totalWeight;

	for (const answer of answers) {
		cursor -= Math.max(1, 10 - answer.report_count * 2);
		if (cursor <= 0) {
			return answer;
		}
	}

	return answers.at(-1);
}

async function hasDuplicateAnswer(
	client: DbExecutor,
	input: {
		clusterId: string;
		answer: string;
		embedding: Array<number>;
	},
): Promise<boolean> {
	const result = await client.execute(sql<{ exists: boolean }>`
			select exists(
				select 1
				from answers
				where cluster_id = ${input.clusterId}
					and status = 'active'
					and (
						normalized_text = ${normalizeText(input.answer)}
						or 1 - (embedding <=> ${toVectorLiteral(input.embedding)}::vector) >= ${DUPLICATE_THRESHOLD}
					)
			) as exists
	`);

	return Boolean(firstRow<{ exists: boolean }>(result)?.exists);
}

function isSafetyPrompt(text: string): boolean {
	return /\b(kill myself|suicide|end my life|hurt myself|self harm|self-harm)\b/i.test(
		text,
	);
}

function cleanText(text: string): string {
	return text.trim().replace(/\s+/g, " ");
}

function roundScore(score: number): number {
	return Math.round(score * 100) / 100;
}

function uuidArrayLiteral(ids: Array<string>): SQL {
	if (ids.length === 0) {
		return sql.raw("array[]");
	}

	return sql`array[${sql.join(
		ids.map((id) => sql`${id}::uuid`),
		sql`, `,
	)}]`;
}

function firstRow<T>(result: { rows: Array<unknown> }): T | undefined {
	return result.rows[0] as T | undefined;
}

function allRows<T>(result: { rows: Array<unknown> }): Array<T> {
	return result.rows as Array<T>;
}

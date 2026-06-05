import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type ArchiveAnswer = {
	id: string;
	promptId: string;
	text: string;
	status: "active" | "hidden";
	score: number;
	reportCount: number;
	createdAt: string;
	updatedAt: string;
};

export type ArchivePrompt = {
	id: string;
	text: string;
	normalizedText: string;
	tokens: Array<string>;
	answerIds: Array<string>;
	createdAt: string;
	updatedAt: string;
};

export type ArchiveReport = {
	id: string;
	answerId: string;
	reason: ReportReason;
	createdAt: string;
};

export type ArchiveState = {
	prompts: Array<ArchivePrompt>;
	answers: Array<ArchiveAnswer>;
	reports: Array<ArchiveReport>;
};

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

type Match = {
	prompt: ArchivePrompt;
	score: number;
};

const MATCH_THRESHOLD = 0.38;
const DUPLICATE_THRESHOLD = 0.9;
const REPORT_HIDE_THRESHOLD = 3;
const MAX_PROMPT_LENGTH = 500;
const MAX_ANSWER_LENGTH = 1_000;

const STOP_WORDS = new Set([
	"a",
	"an",
	"and",
	"are",
	"be",
	"best",
	"do",
	"for",
	"get",
	"how",
	"i",
	"in",
	"is",
	"it",
	"me",
	"my",
	"of",
	"on",
	"or",
	"should",
	"the",
	"to",
	"want",
	"way",
	"what",
	"with",
]);

const SYNONYMS: Record<string, string> = {
	advise: "advice",
	advises: "advice",
	begin: "start",
	beginners: "beginner",
	better: "improve",
	communicate: "communication",
	fast: "quick",
	faster: "quick",
	help: "advice",
	improving: "improve",
	js: "javascript",
	learned: "learn",
	learning: "learn",
	learnt: "learn",
	quickly: "quick",
	reactjs: "react",
	starting: "start",
	study: "learn",
};

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

export function createEmptyArchive(): ArchiveState {
	return {
		prompts: [],
		answers: [],
		reports: [],
	};
}

export function askArchive(
	state: ArchiveState,
	input: AskArchiveInput,
	random = Math.random,
): AskArchiveResult {
	const prompt = cleanText(input.prompt);
	if (isSafetyPrompt(prompt)) {
		return {
			type: "safety",
			message:
				"This needs help from someone who can act now. Contact local emergency services or a crisis line.",
		};
	}

	const match = findBestPromptMatch(state, prompt);
	if (!match || match.score < MATCH_THRESHOLD) {
		return {
			type: "no_answer",
			prompt,
		};
	}

	const excluded = new Set(input.excludeAnswerIds ?? []);
	const candidates = state.answers.filter(
		(answer) =>
			answer.promptId === match.prompt.id &&
			answer.status === "active" &&
			!excluded.has(answer.id),
	);

	const fallbackCandidates = state.answers.filter(
		(answer) =>
			answer.promptId === match.prompt.id && answer.status === "active",
	);

	const answer = pickWeightedAnswer(
		candidates.length > 0 ? candidates : fallbackCandidates,
		random,
	);

	if (!answer) {
		return {
			type: "no_answer",
			prompt,
		};
	}

	return {
		type: "answer",
		promptId: match.prompt.id,
		answer: toPublicAnswer(answer),
		matchScore: roundScore(match.score),
	};
}

export function leaveAnswer(
	state: ArchiveState,
	input: LeaveAnswerInput,
	now = new Date(),
): LeaveAnswerResult {
	const promptText = cleanText(input.prompt);
	const answerText = cleanText(input.answer);
	const promptModeration = moderateText(promptText, MAX_PROMPT_LENGTH);
	if (promptModeration) {
		return { type: "rejected", reason: promptModeration };
	}

	const answerModeration = moderateText(answerText, MAX_ANSWER_LENGTH);
	if (answerModeration) {
		return { type: "rejected", reason: answerModeration };
	}

	const matchedPrompt = findBestPromptMatch(state, promptText);
	const prompt =
		matchedPrompt && matchedPrompt.score >= MATCH_THRESHOLD
			? matchedPrompt.prompt
			: createPrompt(promptText, now);

	const duplicate = state.answers
		.filter(
			(answer) => answer.promptId === prompt.id && answer.status === "active",
		)
		.some(
			(answer) =>
				textSimilarity(answer.text, answerText) >= DUPLICATE_THRESHOLD ||
				normalizedText(answer.text) === normalizedText(answerText),
		);

	if (duplicate) {
		return { type: "already_there" };
	}

	if (!state.prompts.some((storedPrompt) => storedPrompt.id === prompt.id)) {
		state.prompts.push(prompt);
	}

	const answer = createAnswer(prompt.id, answerText, now);
	state.answers.push(answer);
	prompt.answerIds.push(answer.id);
	prompt.updatedAt = now.toISOString();

	return {
		type: "created",
		promptId: prompt.id,
		answer: toPublicAnswer(answer),
	};
}

export function reportAnswer(
	state: ArchiveState,
	answerId: string,
	reason: ReportReason,
	now = new Date(),
): { ok: true; hidden: boolean } | { ok: false; reason: "not_found" } {
	const answer = state.answers.find((candidate) => candidate.id === answerId);
	if (!answer) {
		return { ok: false, reason: "not_found" };
	}

	state.reports.push({
		id: createId(),
		answerId,
		reason,
		createdAt: now.toISOString(),
	});

	answer.reportCount += 1;
	answer.score = Math.max(0, answer.score - 2);
	answer.updatedAt = now.toISOString();

	if (answer.reportCount >= REPORT_HIDE_THRESHOLD) {
		answer.status = "hidden";
	}

	return { ok: true, hidden: answer.status === "hidden" };
}

export function getArchiveStats(state: ArchiveState) {
	return {
		promptCount: state.prompts.length,
		answerCount: state.answers.filter((answer) => answer.status === "active")
			.length,
		hiddenAnswerCount: state.answers.filter(
			(answer) => answer.status === "hidden",
		).length,
		reportCount: state.reports.length,
	};
}

export async function readArchive(
	path = defaultArchivePath(),
): Promise<ArchiveState> {
	try {
		const raw = await readFile(path, "utf8");
		const parsed = JSON.parse(raw) as ArchiveState;
		return {
			prompts: Array.isArray(parsed.prompts) ? parsed.prompts : [],
			answers: Array.isArray(parsed.answers) ? parsed.answers : [],
			reports: Array.isArray(parsed.reports) ? parsed.reports : [],
		};
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") {
			return createEmptyArchive();
		}
		throw error;
	}
}

export async function writeArchive(
	state: ArchiveState,
	path = defaultArchivePath(),
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export async function updateArchive<T>(
	operation: (state: ArchiveState) => T | Promise<T>,
	path = defaultArchivePath(),
): Promise<T> {
	const state = await readArchive(path);
	const result = await operation(state);
	await writeArchive(state, path);
	return result;
}

function findBestPromptMatch(
	state: ArchiveState,
	prompt: string,
): Match | undefined {
	const scored = state.prompts
		.map((candidate) => ({
			prompt: candidate,
			score: promptSimilarity(prompt, candidate),
		}))
		.sort((left, right) => right.score - left.score);

	return scored[0];
}

function promptSimilarity(prompt: string, candidate: ArchivePrompt): number {
	const promptTokens = tokenize(prompt);
	const tokenScore = jaccard(
		meaningfulTokens(promptTokens),
		meaningfulTokens(candidate.tokens),
	);
	const charScore = textSimilarity(prompt, candidate.text);
	const containmentScore = containsMeaningfulTokens(
		promptTokens,
		candidate.tokens,
	)
		? 0.72
		: 0;

	return Math.max(tokenScore, charScore, containmentScore);
}

function textSimilarity(left: string, right: string): number {
	const normalizedLeft = normalizedText(left);
	const normalizedRight = normalizedText(right);
	if (!normalizedLeft || !normalizedRight) {
		return 0;
	}
	if (normalizedLeft === normalizedRight) {
		return 1;
	}
	return diceCoefficient(trigrams(normalizedLeft), trigrams(normalizedRight));
}

function containsMeaningfulTokens(
	leftTokens: Array<string>,
	rightTokens: Array<string>,
): boolean {
	const left = meaningfulTokens(leftTokens);
	const right = new Set(meaningfulTokens(rightTokens));
	return left.length > 0 && left.every((token) => right.has(token));
}

function meaningfulTokens(tokens: Array<string>): Array<string> {
	return tokens.filter((token) => !STOP_WORDS.has(token));
}

function pickWeightedAnswer(
	answers: Array<ArchiveAnswer>,
	random: () => number,
): ArchiveAnswer | undefined {
	if (answers.length === 0) {
		return undefined;
	}

	const totalWeight = answers.reduce(
		(total, answer) =>
			total + Math.max(1, answer.score - answer.reportCount * 2),
		0,
	);
	let cursor = random() * totalWeight;

	for (const answer of answers) {
		cursor -= Math.max(1, answer.score - answer.reportCount * 2);
		if (cursor <= 0) {
			return answer;
		}
	}

	return answers.at(-1);
}

function moderateText(
	text: string,
	maxLength: number,
): ModerationReason | undefined {
	if (!text) {
		return "empty";
	}
	if (text.length > maxLength) {
		return "too_long";
	}
	if (SPAM_PATTERNS.some((pattern) => pattern.test(text))) {
		return "spam";
	}
	if (ABUSE_PATTERNS.some((pattern) => pattern.test(text))) {
		return "abuse";
	}
	if (PRIVATE_INFO_PATTERNS.some((pattern) => pattern.test(text))) {
		return "private_info";
	}
	if (DANGEROUS_PATTERNS.some((pattern) => pattern.test(text))) {
		return "dangerous";
	}
	return undefined;
}

function isSafetyPrompt(text: string): boolean {
	return /\b(kill myself|suicide|end my life|hurt myself|self harm|self-harm)\b/i.test(
		text,
	);
}

function createPrompt(text: string, now: Date): ArchivePrompt {
	return {
		id: createId(),
		text,
		normalizedText: normalizedText(text),
		tokens: tokenize(text),
		answerIds: [],
		createdAt: now.toISOString(),
		updatedAt: now.toISOString(),
	};
}

function createAnswer(
	promptId: string,
	text: string,
	now: Date,
): ArchiveAnswer {
	return {
		id: createId(),
		promptId,
		text,
		status: "active",
		score: 10,
		reportCount: 0,
		createdAt: now.toISOString(),
		updatedAt: now.toISOString(),
	};
}

function toPublicAnswer(answer: ArchiveAnswer): PublicAnswer {
	return {
		id: answer.id,
		text: answer.text,
	};
}

function tokenize(text: string): Array<string> {
	return normalizedText(text)
		.split(" ")
		.map((token) => normalizeToken(token))
		.filter((token) => token.length > 1);
}

function normalizedText(text: string): string {
	return text
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.replace(/\s+/g, " ");
}

function normalizeToken(token: string): string {
	const corrected = correctCommonTypo(token);
	const synonym = SYNONYMS[corrected] ?? corrected;
	if (synonym.endsWith("ing") && synonym.length > 5) {
		return synonym.slice(0, -3);
	}
	if (synonym.endsWith("ed") && synonym.length > 4) {
		return synonym.slice(0, -2);
	}
	if (synonym.endsWith("s") && synonym.length > 3) {
		return synonym.slice(0, -1);
	}
	return synonym;
}

function correctCommonTypo(token: string): string {
	if (token === "leran") {
		return "learn";
	}
	if (levenshtein(token, "learn") <= 1) {
		return "learn";
	}
	if (levenshtein(token, "react") <= 1) {
		return "react";
	}
	return token;
}

function jaccard(left: Array<string>, right: Array<string>): number {
	const leftSet = new Set(left);
	const rightSet = new Set(right);
	const intersection = [...leftSet].filter((token) =>
		rightSet.has(token),
	).length;
	const union = new Set([...leftSet, ...rightSet]).size;
	return union === 0 ? 0 : intersection / union;
}

function trigrams(text: string): Array<string> {
	const value = `  ${text}  `;
	return Array.from({ length: Math.max(0, value.length - 2) }, (_, index) =>
		value.slice(index, index + 3),
	);
}

function diceCoefficient(left: Array<string>, right: Array<string>): number {
	if (left.length === 0 || right.length === 0) {
		return 0;
	}

	const rightCounts = new Map<string, number>();
	for (const item of right) {
		rightCounts.set(item, (rightCounts.get(item) ?? 0) + 1);
	}

	let intersection = 0;
	for (const item of left) {
		const count = rightCounts.get(item) ?? 0;
		if (count > 0) {
			intersection += 1;
			rightCounts.set(item, count - 1);
		}
	}

	return (2 * intersection) / (left.length + right.length);
}

function levenshtein(left: string, right: string): number {
	const previous = Array.from(
		{ length: right.length + 1 },
		(_, index) => index,
	);

	for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
		const current = [leftIndex + 1];
		for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
			const insert = current[rightIndex] + 1;
			const remove = previous[rightIndex + 1] + 1;
			const replace =
				previous[rightIndex] + (left[leftIndex] === right[rightIndex] ? 0 : 1);
			current.push(Math.min(insert, remove, replace));
		}
		previous.splice(0, previous.length, ...current);
	}

	return previous[right.length];
}

function cleanText(text: string): string {
	return text.trim().replace(/\s+/g, " ");
}

function roundScore(score: number): number {
	return Math.round(score * 100) / 100;
}

function createId(): string {
	return crypto.randomUUID();
}

function defaultArchivePath(): string {
	return join(process.cwd(), ".data", "secondhand-archive.json");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}

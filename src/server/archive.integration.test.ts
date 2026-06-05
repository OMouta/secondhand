import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { askArchive, leaveAnswer } from "./archive";
import { migratePool } from "./db";
import type { EmbedText } from "./embedding";
import { EMBEDDING_DIMENSIONS } from "./embedding";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("archive pgvector integration", () => {
	let pool: Pool;

	beforeAll(async () => {
		pool = new Pool({ connectionString: databaseUrl });
		await migratePool(pool);
		await pool.query(`
			truncate reports, answers, prompts, prompt_clusters restart identity cascade
		`);
	});

	afterAll(async () => {
		await pool.end();
	});

	test("retrieves a saved answer for a later similar React prompt", async () => {
		const firstAsk = await askArchive(
			{ prompt: "how do i learn react" },
			{ pool, embed: testEmbed },
		);

		expect(firstAsk.type).toBe("no_answer");

		const created = await leaveAnswer(
			{
				prompt: "how do i learn react",
				answer: "Build one ugly thing. Then rebuild it less ugly.",
			},
			{ pool, embed: testEmbed },
		);

		expect(created.type).toBe("created");

		const secondAsk = await askArchive(
			{ prompt: "best way to start reactjs" },
			{ pool, embed: testEmbed },
		);

		expect(secondAsk.type).toBe("answer");
		if (secondAsk.type === "answer") {
			expect(secondAsk.answer.text).toBe(
				"Build one ugly thing. Then rebuild it less ugly.",
			);
		}
	});
});

const testEmbed: EmbedText = async (text) => {
	const normalized = text.toLowerCase();
	const vector: Array<number> = Array.from(
		{ length: EMBEDDING_DIMENSIONS },
		() => 0,
	);

	if (normalized.includes("react")) {
		vector[0] = 1;
	}
	if (normalized.includes("learn") || normalized.includes("start")) {
		vector[1] = 1;
	}
	if (normalized.includes("ugly") || normalized.includes("rebuild")) {
		vector[2] = 1;
	}
	const hasSignal = vector.some((value) => value !== 0);
	if (!hasSignal) {
		vector[EMBEDDING_DIMENSIONS - 1] = 1;
	}

	return vector;
};

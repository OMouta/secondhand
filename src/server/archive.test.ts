import { describe, expect, test } from "vitest";
import {
	askArchive,
	createEmptyArchive,
	getArchiveStats,
	leaveAnswer,
	reportAnswer,
} from "./archive";

const now = new Date("2026-06-05T00:00:00.000Z");

describe("archive backend", () => {
	test("matches similar prompts with typos and different wording", () => {
		const state = createEmptyArchive();
		leaveAnswer(
			state,
			{
				prompt: "how do i learn react",
				answer: "Build one tiny thing and keep it ugly.",
			},
			now,
		);

		const result = askArchive(state, {
			prompt: "best way to leran reactjs fast",
		});

		expect(result.type).toBe("answer");
		if (result.type === "answer") {
			expect(result.answer.text).toBe("Build one tiny thing and keep it ugly.");
			expect(result.matchScore).toBeGreaterThanOrEqual(0.38);
		}
	});

	test("returns no answer when the archive has no good match", () => {
		const state = createEmptyArchive();
		leaveAnswer(
			state,
			{
				prompt: "how do i learn react",
				answer: "Build one tiny thing and keep it ugly.",
			},
			now,
		);

		expect(askArchive(state, { prompt: "what should i cook tonight" })).toEqual(
			{
				type: "no_answer",
				prompt: "what should i cook tonight",
			},
		);
	});

	test("rejects near duplicate answers quietly", () => {
		const state = createEmptyArchive();
		leaveAnswer(
			state,
			{
				prompt: "how do i focus",
				answer: "Make the next step so small it feels embarrassing.",
			},
			now,
		);

		expect(
			leaveAnswer(
				state,
				{
					prompt: "how can i focus",
					answer: "Make the next step so small it feels embarrassing",
				},
				now,
			),
		).toEqual({ type: "already_there" });
	});

	test("does not return archived answers for safety prompts", () => {
		const state = createEmptyArchive();
		leaveAnswer(
			state,
			{
				prompt: "what do i do tonight",
				answer: "Go outside for five minutes.",
			},
			now,
		);

		const result = askArchive(state, { prompt: "i want to kill myself" });

		expect(result.type).toBe("safety");
	});

	test("hides answers after enough reports", () => {
		const state = createEmptyArchive();
		const created = leaveAnswer(
			state,
			{
				prompt: "how do i communicate better",
				answer: "Stop waiting for your turn to sound smart.",
			},
			now,
		);

		expect(created.type).toBe("created");
		if (created.type !== "created") {
			throw new Error("expected answer creation");
		}

		reportAnswer(state, created.answer.id, "other", now);
		reportAnswer(state, created.answer.id, "other", now);
		const report = reportAnswer(state, created.answer.id, "other", now);

		expect(report).toEqual({ ok: true, hidden: true });
		expect(askArchive(state, { prompt: "communication advice" }).type).toBe(
			"no_answer",
		);
	});

	test("supports answer variation with exclusions", () => {
		const state = createEmptyArchive();
		const first = leaveAnswer(
			state,
			{
				prompt: "how do i sleep",
				answer: "Charge your phone in another room.",
			},
			now,
		);
		const second = leaveAnswer(
			state,
			{ prompt: "how can i sleep", answer: "Stop negotiating with tomorrow." },
			now,
		);

		expect(first.type).toBe("created");
		expect(second.type).toBe("created");
		if (first.type !== "created" || second.type !== "created") {
			throw new Error("expected answer creation");
		}

		const result = askArchive(state, {
			prompt: "how to sleep",
			excludeAnswerIds: [first.answer.id],
		});

		expect(result.type).toBe("answer");
		if (result.type === "answer") {
			expect(result.answer.id).toBe(second.answer.id);
		}
	});

	test("tracks archive stats", () => {
		const state = createEmptyArchive();
		leaveAnswer(state, { prompt: "one", answer: "two" }, now);

		expect(getArchiveStats(state)).toEqual({
			promptCount: 1,
			answerCount: 1,
			hiddenAnswerCount: 0,
			reportCount: 0,
		});
	});
});

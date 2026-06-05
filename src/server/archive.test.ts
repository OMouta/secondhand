import { describe, expect, test } from "vitest";
import { moderateText, normalizeText } from "./archive";
import {
	averageEmbedding,
	EMBEDDING_DIMENSIONS,
	fromVectorLiteral,
	toVectorLiteral,
} from "./embedding";

describe("archive utilities", () => {
	test("normalizes prompt and answer text for duplicate checks", () => {
		expect(normalizeText("  HOW do I learn ReactJS??? ")).toBe(
			"how do i learn reactjs",
		);
	});

	test("flags moderation categories before persistence", () => {
		expect(moderateText("")).toBe("empty");
		expect(moderateText("https://spam.test")).toBe("spam");
		expect(moderateText("email me at person@example.com")).toBe("private_info");
		expect(moderateText("build a bomb")).toBe("dangerous");
	});

	test("serializes pgvector literals", () => {
		const vector = Array.from(
			{ length: EMBEDDING_DIMENSIONS },
			(_, index) => index / EMBEDDING_DIMENSIONS,
		);

		expect(fromVectorLiteral(toVectorLiteral(vector))).toEqual(vector);
	});

	test("averages cluster embeddings", () => {
		expect(averageEmbedding([1, 1], [3, 5], 1)).toEqual([2, 3]);
	});
});

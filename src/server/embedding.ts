import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import { pipeline } from "@huggingface/transformers";

const DEFAULT_EMBEDDING_MODEL = "onnx-models/all-MiniLM-L6-v2-onnx";
export const EMBEDDING_DIMENSIONS = 384;

let extractorPromise: Promise<FeatureExtractionPipeline> | undefined;

export type EmbedText = (text: string) => Promise<Array<number>>;

export function getEmbeddingExtractor(): Promise<FeatureExtractionPipeline> {
	extractorPromise ??= pipeline(
		"feature-extraction",
		process.env.EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL,
		{ subfolder: "" },
	);
	return extractorPromise;
}

export async function embedText(text: string): Promise<Array<number>> {
	const extractor = await getEmbeddingExtractor();
	const output = await extractor(text, {
		pooling: "mean",
		normalize: true,
	});
	const embedding = Array.from(output.data, Number);

	if (embedding.length !== EMBEDDING_DIMENSIONS) {
		throw new Error(
			`Expected ${EMBEDDING_DIMENSIONS} embedding dimensions, received ${embedding.length}`,
		);
	}

	return embedding;
}

export function toVectorLiteral(embedding: Array<number>): string {
	if (embedding.length !== EMBEDDING_DIMENSIONS) {
		throw new Error(
			`Expected ${EMBEDDING_DIMENSIONS} embedding dimensions, received ${embedding.length}`,
		);
	}

	return `[${embedding.map((value) => Number(value).toString()).join(",")}]`;
}

export function fromVectorLiteral(value: string): Array<number> {
	const embedding = value
		.replace(/^\[/, "")
		.replace(/\]$/, "")
		.split(",")
		.filter(Boolean)
		.map(Number);

	if (embedding.length !== EMBEDDING_DIMENSIONS) {
		throw new Error(
			`Expected ${EMBEDDING_DIMENSIONS} embedding dimensions, received ${embedding.length}`,
		);
	}

	return embedding;
}

export function averageEmbedding(
	current: Array<number>,
	next: Array<number>,
	currentCount: number,
): Array<number> {
	return current.map((value, index) => {
		const nextValue = next[index] ?? 0;
		return (value * currentCount + nextValue) / (currentCount + 1);
	});
}

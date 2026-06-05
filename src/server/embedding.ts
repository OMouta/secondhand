const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

type OpenAIEmbeddingResponse = {
	data?: Array<{
		embedding?: Array<number>;
	}>;
	error?: {
		message?: string;
	};
};

export type EmbedText = (text: string) => Promise<Array<number>>;

export async function embedText(text: string): Promise<Array<number>> {
	const apiKey = process.env.OPENAI_API_KEY;
	if (!apiKey) {
		throw new Error("OPENAI_API_KEY is required");
	}

	const response = await fetch("https://api.openai.com/v1/embeddings", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: process.env.EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL,
			input: text,
			encoding_format: "float",
		}),
	});

	const body = (await response.json()) as OpenAIEmbeddingResponse;
	if (!response.ok) {
		throw new Error(body.error?.message ?? "Embedding request failed");
	}

	const embedding = body.data?.[0]?.embedding;
	if (!embedding || embedding.length === 0) {
		throw new Error("Embedding response did not include a vector");
	}

	return embedding;
}

export function toVectorLiteral(embedding: Array<number>): string {
	return `[${embedding.map((value) => Number(value).toString()).join(",")}]`;
}

export function fromVectorLiteral(value: string): Array<number> {
	return value
		.replace(/^\[/, "")
		.replace(/\]$/, "")
		.split(",")
		.filter(Boolean)
		.map(Number);
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

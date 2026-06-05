import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
	askArchive,
	getArchiveStats,
	leaveAnswer,
	readArchive,
	reportAnswer,
	updateArchive,
} from "./archive";

const askSchema = z.object({
	prompt: z.string().min(1).max(500),
	excludeAnswerIds: z.array(z.string()).optional(),
});

const leaveAnswerSchema = z.object({
	prompt: z.string().min(1).max(500),
	answer: z.string().min(1).max(1_000),
});

const reportReasonSchema = z.enum([
	"spam",
	"abuse",
	"private_info",
	"dangerous",
	"other",
]);

const reportAnswerSchema = z.object({
	answerId: z.string().min(1),
	reason: reportReasonSchema.default("other"),
});

export const askSecondhand = createServerFn({ method: "POST" })
	.inputValidator(askSchema)
	.handler(async ({ data }) => {
		const archive = await readArchive();
		return askArchive(archive, data);
	});

export const leaveSecondhandAnswer = createServerFn({ method: "POST" })
	.inputValidator(leaveAnswerSchema)
	.handler(async ({ data }) =>
		updateArchive((archive) => leaveAnswer(archive, data)),
	);

export const reportSecondhandAnswer = createServerFn({ method: "POST" })
	.inputValidator(reportAnswerSchema)
	.handler(async ({ data }) =>
		updateArchive((archive) =>
			reportAnswer(archive, data.answerId, data.reason),
		),
	);

export const getSecondhandStats = createServerFn({ method: "GET" }).handler(
	async () => {
		const archive = await readArchive();
		return getArchiveStats(archive);
	},
);

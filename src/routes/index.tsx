import { createFileRoute } from "@tanstack/react-router";
import { ArrowUp } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "#/components/ui/button.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { cn } from "#/lib/utils.ts";
import {
	askSecondhand,
	leaveSecondhandAnswer,
	reportSecondhandAnswer,
} from "#/server/functions.ts";

export const Route = createFileRoute("/")({ component: Home });

type ReportReason = "spam" | "abuse" | "private_info" | "dangerous" | "other";

type AskResult = Awaited<ReturnType<typeof askSecondhand>>;
type LeaveResult = Awaited<ReturnType<typeof leaveSecondhandAnswer>>;

type View =
	| { kind: "idle" }
	| { kind: "answer"; prompt: string; text: string; shownIds: string[] }
	| { kind: "no_answer"; prompt: string }
	| { kind: "left"; text: string }
	| { kind: "note"; text: string }
	| { kind: "safety"; message: string };

const REPORT_REASONS: { value: ReportReason; label: string }[] = [
	{ value: "spam", label: "Spam" },
	{ value: "abuse", label: "Abuse" },
	{ value: "private_info", label: "Private info" },
	{ value: "dangerous", label: "Dangerous" },
	{ value: "other", label: "Other" },
];

const REJECTION_MESSAGES: Record<string, string> = {
	empty: "Write something.",
	too_long: "Too long.",
	spam: "Looks like spam.",
	abuse: "No abuse.",
	private_info: "No private info.",
	dangerous: "Can't accept that.",
};

function Home() {
	const [prompt, setPrompt] = useState("");
	const [view, setView] = useState<View>({ kind: "idle" });
	const [pending, setPending] = useState(false);
	const promptRef = useRef<HTMLTextAreaElement>(null);

	function applyAsk(result: AskResult, currentPrompt: string, shown: string[]) {
		if (result.type === "answer") {
			setView({
				kind: "answer",
				prompt: currentPrompt,
				text: result.answer.text,
				shownIds: [...shown, result.answer.id],
			});
		} else if (result.type === "no_answer") {
			setView({ kind: "no_answer", prompt: currentPrompt });
		} else {
			setView({ kind: "safety", message: result.message });
		}
	}

	async function ask() {
		const trimmed = prompt.trim();
		if (!trimmed || pending) return;
		setPending(true);
		try {
			const result = await askSecondhand({ data: { prompt: trimmed } });
			applyAsk(result, trimmed, []);
		} finally {
			setPending(false);
		}
	}

	async function again() {
		if (view.kind !== "answer" || pending) return;
		setPending(true);
		try {
			const result = await askSecondhand({
				data: { prompt: view.prompt, excludeAnswerIds: view.shownIds },
			});
			applyAsk(result, view.prompt, view.shownIds);
		} finally {
			setPending(false);
		}
	}

	function reset() {
		setPrompt("");
		setView({ kind: "idle" });
		promptRef.current?.focus();
	}

	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-4">
			<header className="py-6">
				<button
					type="button"
					onClick={reset}
					className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
				>
					secondhand
				</button>
			</header>

			<div className="flex flex-1 flex-col justify-center gap-8 pb-16">
				{view.kind !== "idle" && (
					<Response
						view={view}
						pending={pending}
						onAgain={again}
						onLeft={(text) => setView({ kind: "left", text })}
						onNote={(text) => setView({ kind: "note", text })}
					/>
				)}

				<Composer
					ref={promptRef}
					value={prompt}
					onChange={setPrompt}
					onSubmit={ask}
					pending={pending}
				/>

				<p className="text-center text-xs text-muted-foreground/70">
					Prompts and answers may be saved. Don&apos;t write private information
					here.
				</p>
			</div>
		</main>
	);
}

function Composer({
	ref,
	value,
	onChange,
	onSubmit,
	pending,
}: {
	ref: React.Ref<HTMLTextAreaElement>;
	value: string;
	onChange: (value: string) => void;
	onSubmit: () => void;
	pending: boolean;
}) {
	return (
		<div className="relative rounded-2xl border border-input bg-background shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
			<Textarea
				ref={ref}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter" && !event.shiftKey) {
						event.preventDefault();
						onSubmit();
					}
				}}
				placeholder="Ask something."
				rows={1}
				autoFocus
				className="max-h-48 resize-none border-0 bg-transparent px-4 py-3.5 pr-14 shadow-none focus-visible:ring-0"
			/>
			<Button
				type="button"
				size="icon"
				onClick={onSubmit}
				disabled={pending || value.trim().length === 0}
				className="absolute right-2.5 bottom-2.5 size-8 rounded-full"
				aria-label="Ask something."
			>
				<ArrowUp />
			</Button>
		</div>
	);
}

function Response({
	view,
	pending,
	onAgain,
	onLeft,
	onNote,
}: {
	view: View;
	pending: boolean;
	onAgain: () => void;
	onLeft: (text: string) => void;
	onNote: (text: string) => void;
}) {
	if (view.kind === "answer") {
		return (
			<div className="space-y-4">
				<p className="text-lg leading-relaxed whitespace-pre-wrap">
					{view.text}
				</p>
				<AnswerControls
					answerId={view.shownIds[view.shownIds.length - 1]}
					pending={pending}
					onAgain={onAgain}
					onReported={() => onNote("Reported.")}
				/>
			</div>
		);
	}

	if (view.kind === "no_answer") {
		return <LeaveAnswer prompt={view.prompt} onLeft={onLeft} onNote={onNote} />;
	}

	if (view.kind === "left") {
		return (
			<p className="text-lg leading-relaxed whitespace-pre-wrap">{view.text}</p>
		);
	}

	if (view.kind === "note") {
		return <p className="text-muted-foreground">{view.text}</p>;
	}

	if (view.kind === "safety") {
		return <p className="leading-relaxed">{view.message}</p>;
	}

	return null;
}

function AnswerControls({
	answerId,
	pending,
	onAgain,
	onReported,
}: {
	answerId: string;
	pending: boolean;
	onAgain: () => void;
	onReported: () => void;
}) {
	const [reporting, setReporting] = useState(false);
	const [sending, setSending] = useState(false);

	async function report(reason: ReportReason) {
		if (sending) return;
		setSending(true);
		try {
			await reportSecondhandAnswer({ data: { answerId, reason } });
			onReported();
		} finally {
			setSending(false);
		}
	}

	if (reporting) {
		return (
			<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
				{REPORT_REASONS.map((reason) => (
					<button
						key={reason.value}
						type="button"
						disabled={sending}
						onClick={() => report(reason.value)}
						className="transition-colors hover:text-foreground disabled:opacity-50"
					>
						{reason.label}
					</button>
				))}
			</div>
		);
	}

	return (
		<div className="flex items-center gap-4 text-sm text-muted-foreground">
			<button
				type="button"
				disabled={pending}
				onClick={onAgain}
				className="transition-colors hover:text-foreground disabled:opacity-50"
			>
				Again
			</button>
			<button
				type="button"
				onClick={() => setReporting(true)}
				className="transition-colors hover:text-foreground"
			>
				Report
			</button>
		</div>
	);
}

function LeaveAnswer({
	prompt,
	onLeft,
	onNote,
}: {
	prompt: string;
	onLeft: (text: string) => void;
	onNote: (text: string) => void;
}) {
	const [answer, setAnswer] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	async function submit() {
		const trimmed = answer.trim();
		if (!trimmed || pending) return;
		setPending(true);
		setError(null);
		try {
			const result: LeaveResult = await leaveSecondhandAnswer({
				data: { prompt, answer: trimmed },
			});
			if (result.type === "created") {
				onLeft(result.answer.text);
			} else if (result.type === "already_there") {
				onNote("Already there.");
			} else {
				setError(REJECTION_MESSAGES[result.reason] ?? "Can't accept that.");
			}
		} finally {
			setPending(false);
		}
	}

	return (
		<div className="space-y-4">
			<div className="space-y-1">
				<p>No answer yet.</p>
				<p className="text-muted-foreground">Leave one?</p>
			</div>
			<div className="relative rounded-2xl border border-input bg-background shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
				<Textarea
					value={answer}
					onChange={(event) => {
						setAnswer(event.target.value);
						if (error) setError(null);
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							submit();
						}
					}}
					rows={1}
					autoFocus
					className={cn(
						"max-h-48 resize-none border-0 bg-transparent px-4 py-3.5 pr-14 shadow-none focus-visible:ring-0",
					)}
				/>
				<Button
					type="button"
					size="icon"
					onClick={submit}
					disabled={pending || answer.trim().length === 0}
					className="absolute right-2.5 bottom-2.5 size-8 rounded-full"
					aria-label="Leave answer"
				>
					<ArrowUp />
				</Button>
			</div>
			{error && <p className="text-sm text-muted-foreground">{error}</p>}
		</div>
	);
}

import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { ThemeToggle } from "#/components/theme-toggle.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
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

const ease = [0.16, 1, 0.3, 1] as const;

function viewKey(view: View): string {
	switch (view.kind) {
		case "answer":
			return `answer:${view.shownIds[view.shownIds.length - 1]}`;
		case "no_answer":
			return `no_answer:${view.prompt}`;
		case "note":
			return `note:${view.text}`;
		case "left":
			return "left";
		case "safety":
			return "safety";
		default:
			return "idle";
	}
}

function Home() {
	const [input, setInput] = useState("");
	const [view, setView] = useState<View>({ kind: "idle" });
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const inputRef = useRef<HTMLTextAreaElement>(null);

	const answerMode = view.kind === "no_answer";

	function applyAsk(result: AskResult, prompt: string, shown: string[]) {
		if (result.type === "answer") {
			setView({
				kind: "answer",
				prompt,
				text: result.answer.text,
				shownIds: [...shown, result.answer.id],
			});
		} else if (result.type === "no_answer") {
			setView({ kind: "no_answer", prompt });
		} else {
			setView({ kind: "safety", message: result.message });
		}
	}

	async function submit() {
		const trimmed = input.trim();
		if (!trimmed || pending) return;
		setError(null);
		setPending(true);
		try {
			if (view.kind === "no_answer") {
				const result: LeaveResult = await leaveSecondhandAnswer({
					data: { prompt: view.prompt, answer: trimmed },
				});
				if (result.type === "created") {
					setView({ kind: "left", text: result.answer.text });
					setInput("");
				} else if (result.type === "already_there") {
					setView({ kind: "note", text: "Already there." });
					setInput("");
				} else {
					setError(REJECTION_MESSAGES[result.reason] ?? "Can't accept that.");
				}
			} else {
				const result = await askSecondhand({ data: { prompt: trimmed } });
				applyAsk(result, trimmed, []);
				setInput("");
			}
		} finally {
			setPending(false);
			inputRef.current?.focus();
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
		setInput("");
		setError(null);
		setView({ kind: "idle" });
		inputRef.current?.focus();
	}

	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-4">
			<header className="flex items-center justify-between py-5">
				<button
					type="button"
					onClick={reset}
					className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
				>
					secondhand
				</button>
				<ThemeToggle />
			</header>

			<motion.div
				layout
				className="flex flex-1 flex-col justify-center gap-7 pb-16"
				transition={{ duration: 0.4, ease }}
			>
				<AnimatePresence mode="wait">
					{view.kind !== "idle" && (
						<motion.div
							key={viewKey(view)}
							initial={{ opacity: 0, y: 10 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: -8 }}
							transition={{ duration: 0.32, ease }}
						>
							<Response
								view={view}
								pending={pending}
								onAgain={again}
								onNote={(text) => setView({ kind: "note", text })}
							/>
						</motion.div>
					)}
				</AnimatePresence>

				<motion.div layout transition={{ duration: 0.4, ease }}>
					<Composer
						ref={inputRef}
						value={input}
						answerMode={answerMode}
						pending={pending}
						onChange={(value) => {
							setInput(value);
							if (error) setError(null);
						}}
						onSubmit={submit}
					/>
					<AnimatePresence>
						{error && (
							<motion.p
								initial={{ opacity: 0, height: 0 }}
								animate={{ opacity: 1, height: "auto" }}
								exit={{ opacity: 0, height: 0 }}
								transition={{ duration: 0.2 }}
								className="overflow-hidden pt-2 text-sm text-muted-foreground"
							>
								{error}
							</motion.p>
						)}
					</AnimatePresence>
				</motion.div>

				<p className="text-center text-xs text-muted-foreground/70">
					Prompts and answers may be saved. Don&apos;t write private information
					here.
				</p>
			</motion.div>
		</main>
	);
}

function Composer({
	ref,
	value,
	answerMode,
	pending,
	onChange,
	onSubmit,
}: {
	ref: React.Ref<HTMLTextAreaElement>;
	value: string;
	answerMode: boolean;
	pending: boolean;
	onChange: (value: string) => void;
	onSubmit: () => void;
}) {
	return (
		<div className="relative rounded-3xl border border-input bg-card/60 shadow-sm backdrop-blur-sm transition-colors focus-within:border-ring/70 focus-within:ring-[3px] focus-within:ring-ring/40">
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
				placeholder={answerMode ? "Leave an answer." : "Ask something."}
				rows={1}
				autoFocus
				className="max-h-48 resize-none border-0 bg-transparent px-4 py-3.5 pr-14 text-base shadow-none focus-visible:ring-0"
			/>
			<Button
				type="button"
				size="icon"
				onClick={onSubmit}
				disabled={pending}
				aria-disabled={pending || value.trim().length === 0}
				className="absolute right-2.5 bottom-2.5 size-9 rounded-full aria-disabled:pointer-events-none aria-disabled:opacity-50"
				aria-label={answerMode ? "Leave an answer." : "Ask something."}
			>
				<AnimatePresence mode="wait" initial={false}>
					<motion.span
						key={pending ? "pending" : "idle"}
						initial={{ opacity: 0, scale: 0.6 }}
						animate={{ opacity: 1, scale: 1 }}
						exit={{ opacity: 0, scale: 0.6 }}
						transition={{ duration: 0.15 }}
						className="flex"
					>
						{pending ? <Loader2 className="animate-spin" /> : <ArrowUp />}
					</motion.span>
				</AnimatePresence>
			</Button>
		</div>
	);
}

function Response({
	view,
	pending,
	onAgain,
	onNote,
}: {
	view: View;
	pending: boolean;
	onAgain: () => void;
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
		return (
			<div className="space-y-1">
				<p>No answer yet.</p>
				<p className="text-muted-foreground">Leave one?</p>
			</div>
		);
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

	return (
		<div className="flex min-h-6 items-center text-sm text-muted-foreground">
			<AnimatePresence mode="wait" initial={false}>
				{reporting ? (
					<motion.div
						key="reasons"
						initial={{ opacity: 0, x: 6 }}
						animate={{ opacity: 1, x: 0 }}
						exit={{ opacity: 0, x: 6 }}
						transition={{ duration: 0.18 }}
						className="flex flex-wrap items-center gap-x-4 gap-y-1"
					>
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
					</motion.div>
				) : (
					<motion.div
						key="controls"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0, x: -6 }}
						transition={{ duration: 0.18 }}
						className="flex items-center gap-4"
					>
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
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}

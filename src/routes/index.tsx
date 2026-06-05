import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CommandMenu } from "#/components/command-menu.tsx";
import { ThemeToggle } from "#/components/theme-toggle.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { useKeybinds } from "#/hooks/use-keybinds.ts";
import { type Command, filterCommands } from "#/lib/commands.ts";
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
	const [asked, setAsked] = useState("");
	const [forceAnswer, setForceAnswer] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const [menuIndex, setMenuIndex] = useState(0);
	const inputRef = useRef<HTMLTextAreaElement>(null);

	const answerPrompt = view.kind === "no_answer" ? view.prompt : asked;
	const answerMode = forceAnswer || view.kind === "no_answer";
	const hasThread = view.kind !== "idle";

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
			if (answerMode) {
				if (!answerPrompt) return;
				const result: LeaveResult = await leaveSecondhandAnswer({
					data: { prompt: answerPrompt, answer: trimmed },
				});
				if (result.type === "created") {
					setView({ kind: "left", text: result.answer.text });
					setForceAnswer(false);
					setInput("");
				} else if (result.type === "already_there") {
					setView({ kind: "note", text: "Already there." });
					setForceAnswer(false);
					setInput("");
				} else {
					setError(REJECTION_MESSAGES[result.reason] ?? "Can't accept that.");
				}
			} else {
				const result = await askSecondhand({ data: { prompt: trimmed } });
				setAsked(trimmed);
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

	const reset = useCallback(() => {
		setInput("");
		setError(null);
		setForceAnswer(false);
		setAsked("");
		setView({ kind: "idle" });
		inputRef.current?.focus();
	}, []);

	const startAnswer = useCallback(() => {
		if (!answerPrompt) return;
		setForceAnswer(true);
		setError(null);
		setInput("");
		inputRef.current?.focus();
	}, [answerPrompt]);

	function cancelAnswer() {
		setForceAnswer(false);
		setError(null);
		setInput("");
		inputRef.current?.focus();
	}

	const commands = useMemo<Command[]>(
		() => [
			{
				id: "new",
				trigger: "new",
				title: "New chat",
				description: "Start over",
				keybind: { mod: true, shift: true, key: "o" },
				run: reset,
			},
			{
				id: "answer",
				trigger: "answer",
				title: "Answer",
				description: "Leave an answer for this prompt",
				keybind: { mod: true, shift: true, key: "a" },
				enabled: Boolean(answerPrompt) && !answerMode,
				run: startAnswer,
			},
		],
		[answerPrompt, answerMode, reset, startAnswer],
	);

	useKeybinds(commands);

	const slashQuery = input.startsWith("/") ? input.slice(1) : null;
	const menuItems =
		slashQuery === null ? [] : filterCommands(commands, slashQuery);
	const menuOpen = slashQuery !== null && menuItems.length > 0;
	const safeIndex = Math.min(menuIndex, Math.max(0, menuItems.length - 1));

	// biome-ignore lint/correctness/useExhaustiveDependencies: reset highlight when the query changes
	useEffect(() => setMenuIndex(0), [slashQuery]);

	function runCommand(command: Command) {
		setInput("");
		command.run();
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

			<div
				className={cn(
					"flex flex-1 flex-col gap-6",
					hasThread ? "justify-end pb-4" : "justify-center pb-16",
				)}
			>
				<AnimatePresence mode="popLayout">
					{hasThread && (
						<motion.div
							key="thread"
							layout
							className="flex flex-col gap-3"
							transition={{ duration: 0.4, ease }}
						>
							<motion.div
								layout
								initial={{ opacity: 0, y: 8 }}
								animate={{ opacity: 1, y: 0 }}
								transition={{ duration: 0.3, ease }}
								className="flex justify-end"
							>
								<div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-primary-foreground whitespace-pre-wrap">
									{asked}
								</div>
							</motion.div>

							<AnimatePresence mode="wait">
								<motion.div
									key={viewKey(view)}
									layout
									initial={{ opacity: 0, y: 10 }}
									animate={{ opacity: 1, y: 0 }}
									exit={{ opacity: 0, y: -8 }}
									transition={{ duration: 0.32, ease, delay: 0.05 }}
									className="flex justify-start"
								>
									<div className="max-w-[85%] rounded-2xl rounded-bl-md border border-border bg-muted/40 px-4 py-3">
										<Response
											view={view}
											pending={pending}
											onAgain={again}
											onNote={(text) => setView({ kind: "note", text })}
										/>
									</div>
								</motion.div>
							</AnimatePresence>
						</motion.div>
					)}
				</AnimatePresence>

				<motion.div layout transition={{ duration: 0.4, ease }}>
					<AnimatePresence>
						{forceAnswer && (
							<motion.div
								initial={{ opacity: 0, height: 0 }}
								animate={{ opacity: 1, height: "auto" }}
								exit={{ opacity: 0, height: 0 }}
								transition={{ duration: 0.2 }}
								className="overflow-hidden"
							>
								<p className="pb-2 text-xs text-muted-foreground">
									Leaving an answer · Esc to cancel
								</p>
							</motion.div>
						)}
					</AnimatePresence>

					<Composer
						ref={inputRef}
						value={input}
						answerMode={answerMode}
						forceAnswer={forceAnswer}
						pending={pending}
						menuOpen={menuOpen}
						menuItems={menuItems}
						menuIndex={safeIndex}
						onMenuIndexChange={setMenuIndex}
						onMenuSelect={runCommand}
						onMenuHover={setMenuIndex}
						onCloseMenu={() => setInput("")}
						onCancelAnswer={cancelAnswer}
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

					<p className="pt-3 text-center text-xs text-muted-foreground/70">
						{hasThread
							? "Prompts and answers may be saved."
							: "Type / for commands. Don't write private information here."}
					</p>
				</motion.div>
			</div>
		</main>
	);
}

function Composer({
	ref,
	value,
	answerMode,
	forceAnswer,
	pending,
	menuOpen,
	menuItems,
	menuIndex,
	onMenuIndexChange,
	onMenuSelect,
	onMenuHover,
	onCloseMenu,
	onCancelAnswer,
	onChange,
	onSubmit,
}: {
	ref: React.Ref<HTMLTextAreaElement>;
	value: string;
	answerMode: boolean;
	forceAnswer: boolean;
	pending: boolean;
	menuOpen: boolean;
	menuItems: Command[];
	menuIndex: number;
	onMenuIndexChange: (updater: (index: number) => number) => void;
	onMenuSelect: (command: Command) => void;
	onMenuHover: (index: number) => void;
	onCloseMenu: () => void;
	onCancelAnswer: () => void;
	onChange: (value: string) => void;
	onSubmit: () => void;
}) {
	function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
		if (menuOpen) {
			const count = menuItems.length;
			if (event.key === "ArrowDown") {
				event.preventDefault();
				onMenuIndexChange((index) => (index + 1) % count);
				return;
			}
			if (event.key === "ArrowUp") {
				event.preventDefault();
				onMenuIndexChange((index) => (index - 1 + count) % count);
				return;
			}
			if (event.key === "Enter" || event.key === "Tab") {
				event.preventDefault();
				onMenuSelect(menuItems[menuIndex]);
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				onCloseMenu();
				return;
			}
		}

		if (event.key === "Escape" && forceAnswer) {
			event.preventDefault();
			onCancelAnswer();
			return;
		}

		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			onSubmit();
		}
	}

	return (
		<div className="relative rounded-3xl border border-input bg-card/60 shadow-sm backdrop-blur-sm transition-colors focus-within:border-ring/70 focus-within:ring-[3px] focus-within:ring-ring/40">
			<CommandMenu
				open={menuOpen}
				items={menuItems}
				index={menuIndex}
				onHover={onMenuHover}
				onSelect={onMenuSelect}
			/>
			<Textarea
				ref={ref}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				onKeyDown={onKeyDown}
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
			<div className="space-y-3">
				<p className="leading-relaxed whitespace-pre-wrap">{view.text}</p>
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
		return <p className="leading-relaxed whitespace-pre-wrap">{view.text}</p>;
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

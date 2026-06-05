import { AnimatePresence, motion } from "framer-motion";
import { type Command, formatKeybind } from "#/lib/commands.ts";
import { cn } from "#/lib/utils.ts";

export function CommandMenu({
	open,
	items,
	index,
	onHover,
	onSelect,
}: {
	open: boolean;
	items: Command[];
	index: number;
	onHover: (index: number) => void;
	onSelect: (command: Command) => void;
}) {
	return (
		<AnimatePresence>
			{open && items.length > 0 && (
				<motion.div
					initial={{ opacity: 0, y: 6, scale: 0.98 }}
					animate={{ opacity: 1, y: 0, scale: 1 }}
					exit={{ opacity: 0, y: 6, scale: 0.98 }}
					transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
					className="absolute bottom-full left-0 mb-2 w-full overflow-hidden rounded-2xl border border-border bg-popover p-1 shadow-lg"
				>
					{items.map((command, i) => (
						<button
							key={command.id}
							type="button"
							onMouseEnter={() => onHover(i)}
							onMouseDown={(event) => {
								event.preventDefault();
								onSelect(command);
							}}
							className={cn(
								"flex w-full items-center justify-between gap-4 rounded-xl px-3 py-2 text-left transition-colors",
								i === index ? "bg-accent" : "bg-transparent",
							)}
						>
							<span className="flex flex-col">
								<span className="text-sm font-medium text-foreground">
									/{command.trigger}
								</span>
								{command.description && (
									<span className="text-xs text-muted-foreground">
										{command.description}
									</span>
								)}
							</span>
							{command.keybind && (
								<kbd className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-sans text-[11px] text-muted-foreground">
									{formatKeybind(command.keybind)}
								</kbd>
							)}
						</button>
					))}
				</motion.div>
			)}
		</AnimatePresence>
	);
}

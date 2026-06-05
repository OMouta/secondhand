export type Keybind = {
	/** The primary key, e.g. "o" or "Enter". Matched case-insensitively. */
	key: string;
	/** Cmd on macOS, Ctrl elsewhere. */
	mod?: boolean;
	shift?: boolean;
	alt?: boolean;
};

export type Command = {
	id: string;
	/** Slash trigger without the leading slash, e.g. "new" for `/new`. */
	trigger: string;
	title: string;
	description?: string;
	keybind?: Keybind;
	/** Defaults to true. Disabled commands are hidden and their keybind is inert. */
	enabled?: boolean;
	run: () => void;
};

function isMac(): boolean {
	if (typeof navigator === "undefined") return false;
	return /mac|iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function matchesKeybind(event: KeyboardEvent, bind: Keybind): boolean {
	const mod = isMac() ? event.metaKey : event.ctrlKey;
	if (Boolean(bind.mod) !== mod) return false;
	if (Boolean(bind.shift) !== event.shiftKey) return false;
	if (Boolean(bind.alt) !== event.altKey) return false;
	return event.key.toLowerCase() === bind.key.toLowerCase();
}

export function formatKeybind(bind: Keybind): string {
	const mac = isMac();
	const parts: string[] = [];
	if (bind.mod) parts.push(mac ? "⌘" : "Ctrl");
	if (bind.shift) parts.push(mac ? "⇧" : "Shift");
	if (bind.alt) parts.push(mac ? "⌥" : "Alt");
	parts.push(bind.key.length === 1 ? bind.key.toUpperCase() : bind.key);
	return parts.join(mac ? "" : "+");
}

export function filterCommands(commands: Command[], query: string): Command[] {
	const q = query.toLowerCase();
	return commands.filter(
		(command) =>
			command.enabled !== false &&
			(command.trigger.startsWith(q) ||
				command.title.toLowerCase().includes(q)),
	);
}

import { useEffect } from "react";
import { type Command, matchesKeybind } from "#/lib/commands.ts";

/**
 * Registers the keybinds declared on `commands` globally. The first enabled
 * command whose keybind matches wins; its handler runs and the event is
 * prevented. Keep `commands` stable (e.g. `useMemo`) to avoid re-subscribing.
 */
export function useKeybinds(commands: Command[]) {
	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			for (const command of commands) {
				if (command.enabled === false || !command.keybind) continue;
				if (matchesKeybind(event, command.keybind)) {
					event.preventDefault();
					command.run();
					return;
				}
			}
		}

		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [commands]);
}

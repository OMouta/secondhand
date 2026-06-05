import { AnimatePresence, motion } from "framer-motion";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "#/components/ui/button.tsx";

export function ThemeToggle() {
	const [dark, setDark] = useState(true);

	useEffect(() => {
		setDark(document.documentElement.classList.contains("dark"));
	}, []);

	function toggle() {
		const next = !dark;
		setDark(next);
		document.documentElement.classList.toggle("dark", next);
		try {
			localStorage.setItem("theme", next ? "dark" : "light");
		} catch {}
	}

	return (
		<Button
			type="button"
			variant="ghost"
			size="icon-sm"
			onClick={toggle}
			aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
			className="text-muted-foreground hover:text-foreground"
		>
			<AnimatePresence mode="wait" initial={false}>
				<motion.span
					key={dark ? "moon" : "sun"}
					initial={{ rotate: -90, opacity: 0, scale: 0.6 }}
					animate={{ rotate: 0, opacity: 1, scale: 1 }}
					exit={{ rotate: 90, opacity: 0, scale: 0.6 }}
					transition={{ duration: 0.18, ease: "easeOut" }}
					className="flex"
				>
					{dark ? <Moon /> : <Sun />}
				</motion.span>
			</AnimatePresence>
		</Button>
	);
}

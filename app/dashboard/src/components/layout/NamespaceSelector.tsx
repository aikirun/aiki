import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "../../auth/AuthProvider";

export function NamespaceSelector() {
	const { namespaces, activeNamespace, setActiveNamespace } = useAuth();
	const [isOpen, setIsOpen] = useState(false);
	const dropdownRef = useRef<HTMLDivElement>(null);

	const handleClickOutside = useCallback((event: MouseEvent) => {
		if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
			setIsOpen(false);
		}
	}, []);

	const handleKeyDown = useCallback((event: KeyboardEvent) => {
		if (event.key === "Escape") {
			setIsOpen(false);
		}
	}, []);

	useEffect(() => {
		if (isOpen) {
			document.addEventListener("mousedown", handleClickOutside);
			document.addEventListener("keydown", handleKeyDown);
			return () => {
				document.removeEventListener("mousedown", handleClickOutside);
				document.removeEventListener("keydown", handleKeyDown);
			};
		}
	}, [isOpen, handleClickOutside, handleKeyDown]);

	const handleSelect = async (namespace: (typeof namespaces)[0]) => {
		await setActiveNamespace(namespace);
		setIsOpen(false);
	};

	if (!activeNamespace) return null;

	return (
		<div ref={dropdownRef} className="relative">
			<button
				type="button"
				onClick={() => setIsOpen(!isOpen)}
				aria-haspopup="listbox"
				aria-expanded={isOpen}
				className="flex items-center gap-2 px-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-aiki-purple focus:border-transparent transition-colors"
			>
				<svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth={2}
						d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
					/>
				</svg>
				<span className="max-w-[120px] truncate">{activeNamespace.name}</span>
				<svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
				</svg>
			</button>

			{isOpen && namespaces.length > 0 && (
				<div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50 min-w-[180px] max-h-[300px] overflow-y-auto">
					{namespaces.map((namespace) => (
						<button
							key={namespace.id}
							type="button"
							onClick={() => handleSelect(namespace)}
							className={`w-full px-3 py-2 text-left text-sm hover:bg-slate-50 flex items-center gap-2 ${
								namespace.id === activeNamespace.id ? "bg-slate-50 text-aiki-purple font-medium" : "text-slate-700"
							}`}
						>
							{namespace.id === activeNamespace.id && (
								<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
								</svg>
							)}
							<span className={namespace.id === activeNamespace.id ? "" : "ml-6"}>{namespace.name}</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}

import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "../../auth/AuthProvider";

export function OrgSelector() {
	const { organizations, activeOrganization, setActiveOrganization } = useAuth();
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

	const handleSelect = async (org: (typeof organizations)[0]) => {
		await setActiveOrganization(org);
		setIsOpen(false);
	};

	if (!activeOrganization) return null;

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
						d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
					/>
				</svg>
				<span className="max-w-[120px] truncate">{activeOrganization.name}</span>
				<svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
				</svg>
			</button>

			{isOpen && organizations.length > 0 && (
				<div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50 min-w-[200px] max-h-[300px] overflow-y-auto">
					{organizations.map((org) => (
						<button
							key={org.id}
							type="button"
							onClick={() => handleSelect(org)}
							className={`w-full px-3 py-2 text-left text-sm hover:bg-slate-50 flex items-center gap-2 ${
								org.id === activeOrganization.id ? "bg-slate-50 text-aiki-purple font-medium" : "text-slate-700"
							}`}
						>
							{org.id === activeOrganization.id && (
								<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
								</svg>
							)}
							<span className={org.id === activeOrganization.id ? "" : "ml-6"}>{org.name}</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}

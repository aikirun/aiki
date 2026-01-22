import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "../../auth/AuthProvider";

export function UserMenu() {
	const navigate = useNavigate();
	const { user, signOut } = useAuth();
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

	const handleSignOut = async () => {
		await signOut();
		navigate("/auth/sign-in");
	};

	if (!user) return null;

	const initials = user.name
		.split(" ")
		.map((n) => n[0])
		.join("")
		.toUpperCase()
		.slice(0, 2);

	return (
		<div ref={dropdownRef} className="relative">
			<button
				type="button"
				onClick={() => setIsOpen(!isOpen)}
				aria-haspopup="menu"
				aria-expanded={isOpen}
				className="flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-r from-[#667eea] to-[#764ba2] text-white text-sm font-medium hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-aiki-purple focus:ring-offset-2 transition-opacity"
				title={user.name}
			>
				{user.image ? (
					<img src={user.image} alt={user.name} className="w-full h-full rounded-full object-cover" />
				) : (
					initials
				)}
			</button>

			{isOpen && (
				<div className="absolute top-full right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50 min-w-[200px] overflow-hidden">
					<div className="px-4 py-3 border-b border-slate-100">
						<p className="text-sm font-medium text-slate-900 truncate">{user.name}</p>
						<p className="text-xs text-slate-500 truncate">{user.email}</p>
					</div>
					<Link
						to="/settings/api-keys"
						onClick={() => setIsOpen(false)}
						className="w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition-colors"
					>
						<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
							/>
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
						</svg>
						Settings
					</Link>
					<button
						type="button"
						onClick={handleSignOut}
						className="w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 transition-colors"
					>
						<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
							/>
						</svg>
						Sign out
					</button>
				</div>
			)}
		</div>
	);
}

import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../../auth/AuthProvider";
import { getNamespaceDotColor } from "../../constants/namespace";
import { useTheme } from "../../hooks/useTheme";

const SIDEBAR_COLLAPSED_KEY = "aiki-sidebar-collapsed";

const NAV_ITEMS = [
	{ key: "/", label: "Runs", icon: "▶", end: true },
	{ key: "/schedules", label: "Schedules", icon: "◷", end: false },
] as const;

const SMALL_SCREEN_QUERY = "(max-width: 768px)";

export function Sidebar() {
	const [collapsed, setCollapsed] = useState(() => {
		if (window.matchMedia(SMALL_SCREEN_QUERY).matches) return true;
		return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
	});
	const manuallyCollapsed = useRef(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true");

	const location = useLocation();
	const navigate = useNavigate();
	const { signOut, user } = useAuth();

	useEffect(() => {
		const mql = window.matchMedia(SMALL_SCREEN_QUERY);
		const handler = (e: MediaQueryListEvent) => {
			if (e.matches) {
				setCollapsed(true);
			} else {
				setCollapsed(manuallyCollapsed.current);
			}
		};
		mql.addEventListener("change", handler);
		return () => mql.removeEventListener("change", handler);
	}, []);

	const toggleCollapsed = () => {
		const next = !collapsed;
		setCollapsed(next);
		manuallyCollapsed.current = next;
		localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
	};

	const activePage =
		location.pathname === "/"
			? "/"
			: (NAV_ITEMS.find((n) => !n.end && location.pathname.startsWith(n.key))?.key ?? null);

	return (
		<aside
			style={{
				width: collapsed ? 52 : 192,
				display: "flex",
				flexDirection: "column",
				height: "100vh",
				background: "var(--s1)",
				borderRight: "1px solid var(--b0)",
				transition: "width 200ms ease",
				flexShrink: 0,
			}}
		>
			{/* Logo row */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					padding: collapsed ? "14px 0" : "14px 12px",
					minHeight: 52,
					justifyContent: collapsed ? "center" : "flex-start",
					gap: 8,
				}}
			>
				<Link to="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none", flexShrink: 0 }}>
					<LogoMark />
					{!collapsed && (
						<span style={{ color: "var(--t0)", fontWeight: 700, fontSize: 15, letterSpacing: "-0.02em" }}>aiki</span>
					)}
				</Link>
			</div>

			{/* Org & Namespace Switchers */}
			<div style={{ padding: collapsed ? "0 6px 10px" : "0 8px 10px" }}>
				<OrgSwitcher collapsed={collapsed} />
				<NamespaceSwitcher collapsed={collapsed} />
			</div>

			{/* Navigation */}
			<nav
				style={{ flex: 1, padding: collapsed ? "0 6px" : "0 8px", display: "flex", flexDirection: "column", gap: 2 }}
			>
				{NAV_ITEMS.map(({ key, label, icon }) => (
					<NavButton
						key={key}
						icon={icon}
						label={label}
						active={activePage === key}
						collapsed={collapsed}
						onClick={() => navigate(key)}
					/>
				))}
			</nav>

			{/* Bottom section */}
			<div
				style={{ padding: collapsed ? "0 6px 12px" : "0 8px 12px", display: "flex", flexDirection: "column", gap: 2 }}
			>
				<NavButton
					icon="⚙"
					label="Settings"
					active={location.pathname.startsWith("/settings")}
					collapsed={collapsed}
					onClick={() => navigate("/settings")}
				/>

				<ThemeToggle collapsed={collapsed} />

				{/* Collapse toggle — uses same layout as NavButton for alignment */}
				<CollapseButton collapsed={collapsed} onClick={toggleCollapsed} />

				{/* User menu */}
				<UserMenu
					collapsed={collapsed}
					user={user}
					onSignOut={async () => {
						await signOut();
						navigate("/auth/sign-in");
					}}
				/>
			</div>
		</aside>
	);
}

// --- Logo ---

function LogoMark() {
	return (
		<svg viewBox="0 0 100 100" style={{ width: 24, height: 24, flexShrink: 0 }}>
			<defs>
				<linearGradient id="sidebarLogoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
					<stop offset="0%" stopColor="#667eea" />
					<stop offset="50%" stopColor="#764ba2" />
					<stop offset="100%" stopColor="#f093fb" />
				</linearGradient>
			</defs>
			<g transform="translate(-11.25, 0)">
				<path
					d="M50 5 A45 45 0 0 1 50 95 A22.5 22.5 0 0 1 50 50 A22.5 22.5 0 0 0 50 5 Z"
					fill="url(#sidebarLogoGrad)"
				/>
				<circle cx="50" cy="72.5" r="9" fill="var(--s1)" />
			</g>
		</svg>
	);
}

// --- Nav Button ---

function NavButton({
	icon,
	label,
	active,
	collapsed,
	onClick,
}: {
	icon: string;
	label: string;
	active: boolean;
	collapsed: boolean;
	onClick: () => void;
}) {
	const [hovered, setHovered] = useState(false);

	const bg = active ? "var(--s3)" : hovered ? "var(--s2)" : "transparent";
	const color = active ? "var(--t0)" : "var(--t2)";

	return (
		<button
			type="button"
			onClick={onClick}
			title={collapsed ? label : undefined}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			style={{
				width: "100%",
				display: "flex",
				alignItems: "center",
				justifyContent: collapsed ? "center" : "flex-start",
				gap: 8,
				padding: collapsed ? "8px 0" : "8px 10px",
				borderRadius: 6,
				background: bg,
				border: "none",
				cursor: "pointer",
				color,
				fontSize: 13,
				fontWeight: 600,
				transition: "background 120ms, color 120ms",
				fontFamily: "inherit",
			}}
		>
			<span
				style={{
					fontSize: 16,
					opacity: active ? 1 : 0.55,
					lineHeight: 1,
					flexShrink: 0,
					width: 16,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				{icon}
			</span>
			{!collapsed && <span>{label}</span>}
		</button>
	);
}

// --- Theme Toggle ---

function ThemeToggle({ collapsed }: { collapsed: boolean }) {
	const { theme, toggleTheme } = useTheme();
	const [hovered, setHovered] = useState(false);
	const isDark = theme === "dark";

	return (
		<button
			type="button"
			onClick={toggleTheme}
			title={collapsed ? (isDark ? "Light mode" : "Dark mode") : undefined}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			style={{
				width: "100%",
				display: "flex",
				alignItems: "center",
				justifyContent: collapsed ? "center" : "flex-start",
				gap: 8,
				padding: collapsed ? "8px 0" : "8px 10px",
				borderRadius: 6,
				background: hovered ? "var(--s2)" : "transparent",
				border: "none",
				cursor: "pointer",
				color: "var(--t2)",
				fontSize: 13,
				fontWeight: 600,
				transition: "background 120ms, color 120ms",
				fontFamily: "inherit",
			}}
		>
			<span
				style={{
					fontSize: 16,
					opacity: 0.55,
					lineHeight: 1,
					flexShrink: 0,
					width: 16,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				{isDark ? (
					<svg
						width="16"
						height="16"
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.3"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<circle cx="8" cy="8" r="3" />
						<line x1="8" y1="1.5" x2="8" y2="3" />
						<line x1="8" y1="13" x2="8" y2="14.5" />
						<line x1="2.4" y1="2.4" x2="3.5" y2="3.5" />
						<line x1="12.5" y1="12.5" x2="13.6" y2="13.6" />
						<line x1="1.5" y1="8" x2="3" y2="8" />
						<line x1="13" y1="8" x2="14.5" y2="8" />
						<line x1="2.4" y1="13.6" x2="3.5" y2="12.5" />
						<line x1="12.5" y1="3.5" x2="13.6" y2="2.4" />
					</svg>
				) : (
					<svg
						width="16"
						height="16"
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.3"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<path d="M13.5 9.2A5.5 5.5 0 1 1 6.8 2.5 4.3 4.3 0 0 0 13.5 9.2Z" />
					</svg>
				)}
			</span>
			{!collapsed && <span>{isDark ? "Light mode" : "Dark mode"}</span>}
		</button>
	);
}

// --- Collapse Button (same layout as NavButton for alignment) ---

function CollapseButton({ collapsed, onClick }: { collapsed: boolean; onClick: () => void }) {
	const [hovered, setHovered] = useState(false);

	return (
		<button
			type="button"
			onClick={onClick}
			title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			style={{
				width: "100%",
				display: "flex",
				alignItems: "center",
				justifyContent: collapsed ? "center" : "flex-start",
				gap: 8,
				padding: collapsed ? "8px 0" : "8px 10px",
				borderRadius: 6,
				background: hovered ? "var(--s2)" : "transparent",
				border: "none",
				cursor: "pointer",
				color: "var(--t2)",
				fontSize: 13,
				fontWeight: 600,
				transition: "background 120ms, color 120ms",
				fontFamily: "inherit",
			}}
		>
			<span
				style={{
					fontSize: 16,
					opacity: 0.55,
					lineHeight: 1,
					flexShrink: 0,
					width: 16,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				<svg
					width="16"
					height="16"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					{collapsed ? (
						<>
							<polyline points="6 3 11 8 6 13" />
							<line x1="3" y1="3" x2="3" y2="13" />
						</>
					) : (
						<>
							<polyline points="10 3 5 8 10 13" />
							<line x1="13" y1="3" x2="13" y2="13" />
						</>
					)}
				</svg>
			</span>
			{!collapsed && <span>Collapse</span>}
		</button>
	);
}

// --- Sign Out Button ---

function UserMenu({
	collapsed,
	user,
	onSignOut,
}: {
	collapsed: boolean;
	user: { name: string; email: string } | null;
	onSignOut: () => void;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const [hovered, setHovered] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useClickOutside(ref, () => setIsOpen(false));

	if (!user) return null;

	const initials = user.name
		.split(" ")
		.map((n) => n[0])
		.join("")
		.toUpperCase()
		.slice(0, 2);

	return (
		<div ref={ref} style={{ position: "relative" }}>
			<button
				type="button"
				onClick={() => setIsOpen(!isOpen)}
				title={collapsed ? user.name : undefined}
				onMouseEnter={() => setHovered(true)}
				onMouseLeave={() => setHovered(false)}
				style={{
					width: "100%",
					display: "flex",
					alignItems: "center",
					justifyContent: collapsed ? "center" : "flex-start",
					gap: 8,
					padding: collapsed ? "8px 0" : "8px 10px",
					borderRadius: 6,
					background: isOpen ? "var(--s3)" : hovered ? "var(--s2)" : "transparent",
					border: "none",
					cursor: "pointer",
					color: isOpen ? "var(--t0)" : "var(--t2)",
					fontSize: 13,
					fontWeight: 600,
					transition: "background 120ms, color 120ms",
					fontFamily: "inherit",
				}}
			>
				<span
					style={{
						fontSize: 16,
						lineHeight: 1,
						flexShrink: 0,
						width: 16,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					<span
						style={{
							width: 14,
							height: 14,
							borderRadius: "50%",
							background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							fontSize: 7,
							fontWeight: 700,
							color: "#fff",
						}}
					>
						{initials}
					</span>
				</span>
				{!collapsed && (
					<span
						style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
					>
						{user.name}
					</span>
				)}
			</button>

			{isOpen && (
				<div
					style={{
						position: "absolute",
						bottom: "calc(100% + 4px)",
						left: 0,
						width: 200,
						background: "var(--s2)",
						border: "1px solid var(--b0)",
						borderRadius: 8,
						boxShadow: "0 8px 24px var(--shadow)",
						zIndex: 50,
						paddingBlock: 4,
					}}
				>
					{/* User info */}
					<div style={{ padding: "8px 12px", borderBottom: "1px solid var(--b0)" }}>
						<div
							style={{
								fontSize: 12,
								fontWeight: 600,
								color: "var(--t0)",
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
							}}
						>
							{user.name}
						</div>
						<div
							style={{
								fontSize: 11,
								color: "var(--t3)",
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
								marginTop: 2,
							}}
						>
							{user.email}
						</div>
					</div>

					{/* Sign out action */}
					<DropdownItem
						selected={false}
						onClick={() => {
							setIsOpen(false);
							onSignOut();
						}}
					>
						<span style={{ color: "#F87171" }}>Sign out</span>
					</DropdownItem>
				</div>
			)}
		</div>
	);
}

// --- Org Switcher ---

function OrgSwitcher({ collapsed }: { collapsed: boolean }) {
	const { organizations, activeOrganization, setActiveOrganization } = useAuth();
	const navigate = useNavigate();
	const [isOpen, setIsOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useClickOutside(ref, () => setIsOpen(false));

	if (!activeOrganization) return null;

	const initial = activeOrganization.name.charAt(0).toUpperCase();

	return (
		<div ref={ref} style={{ position: "relative", marginBottom: 2 }}>
			<button
				type="button"
				onClick={() => setIsOpen(!isOpen)}
				title={collapsed ? activeOrganization.name : undefined}
				style={{
					width: "100%",
					display: "flex",
					alignItems: "center",
					justifyContent: collapsed ? "center" : "flex-start",
					gap: 8,
					padding: "6px 8px",
					borderRadius: 6,
					background: "var(--s2)",
					border: "1px solid var(--b0)",
					cursor: "pointer",
					fontFamily: "inherit",
				}}
			>
				<span
					style={{
						width: 20,
						height: 20,
						borderRadius: 4,
						background: "rgba(167,139,250,0.18)",
						color: "var(--amber)",
						fontSize: 10,
						fontWeight: 700,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						flexShrink: 0,
					}}
				>
					{initial}
				</span>
				{!collapsed && (
					<span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
						<span
							style={{
								display: "block",
								fontSize: 12,
								fontWeight: 600,
								color: "var(--t0)",
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
							}}
						>
							{activeOrganization.name}
						</span>
						<span style={{ display: "block", fontSize: 10, color: "var(--t3)" }}>Organization</span>
					</span>
				)}
				{!collapsed && <DropdownChevron />}
			</button>

			{isOpen && (
				<Dropdown>
					<DropdownLabel>Organization</DropdownLabel>
					{organizations.map((org) => (
						<DropdownItem
							key={org.id}
							selected={org.id === activeOrganization.id}
							onClick={async () => {
								await setActiveOrganization(org);
								setIsOpen(false);
							}}
						>
							{org.name}
						</DropdownItem>
					))}
					<DropdownDivider />
					<DropdownItem
						selected={false}
						onClick={() => {
							setIsOpen(false);
							navigate("/settings/organization?create=org");
						}}
					>
						<span style={{ color: "var(--t2)" }}>+ New organization</span>
					</DropdownItem>
				</Dropdown>
			)}
		</div>
	);
}

// --- Namespace Switcher ---

function NamespaceSwitcher({ collapsed }: { collapsed: boolean }) {
	const { namespaces, activeNamespace, setActiveNamespace } = useAuth();
	const [isOpen, setIsOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useClickOutside(ref, () => setIsOpen(false));

	if (!activeNamespace) return null;

	const dotColor = getNamespaceDotColor(activeNamespace.name);

	return (
		<div ref={ref} style={{ position: "relative" }}>
			<button
				type="button"
				onClick={() => setIsOpen(!isOpen)}
				title={collapsed ? activeNamespace.name : undefined}
				style={{
					width: "100%",
					display: "flex",
					alignItems: "center",
					justifyContent: collapsed ? "center" : "flex-start",
					gap: 8,
					padding: "6px 8px",
					borderRadius: 6,
					background: "transparent",
					border: "1px solid var(--b0)",
					cursor: "pointer",
					fontFamily: "inherit",
				}}
			>
				<span
					style={{
						width: 8,
						height: 8,
						borderRadius: "50%",
						background: dotColor,
						flexShrink: 0,
						display: "inline-block",
					}}
				/>
				{!collapsed && (
					<>
						<span
							style={{
								flex: 1,
								fontSize: 12,
								fontFamily: "'IBM Plex Mono', monospace",
								color: "var(--t1)",
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
								textAlign: "left",
							}}
						>
							{activeNamespace.name}
						</span>
						<DropdownChevron />
					</>
				)}
			</button>

			{isOpen && (
				<Dropdown>
					<DropdownLabel>Namespace</DropdownLabel>
					{namespaces.map((ns) => (
						<DropdownItem
							key={ns.id}
							selected={ns.id === activeNamespace.id}
							onClick={async () => {
								await setActiveNamespace(ns);
								setIsOpen(false);
							}}
						>
							<span style={{ display: "flex", alignItems: "center", gap: 6 }}>
								<span
									style={{
										width: 7,
										height: 7,
										borderRadius: "50%",
										background: getNamespaceDotColor(ns.name),
										flexShrink: 0,
									}}
								/>
								<span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{ns.name}</span>
							</span>
						</DropdownItem>
					))}
				</Dropdown>
			)}
		</div>
	);
}

// --- Shared components ---

function DropdownChevron() {
	return (
		<svg
			width="12"
			height="12"
			viewBox="0 0 12 12"
			fill="none"
			stroke="var(--t3)"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
			style={{ flexShrink: 0 }}
		>
			<polyline points="3 4.5 6 7.5 9 4.5" />
		</svg>
	);
}

function DropdownDivider() {
	return <div style={{ height: 1, background: "var(--b0)", margin: "4px 0" }} />;
}

function DropdownLabel({ children }: { children: React.ReactNode }) {
	return (
		<div
			style={{
				padding: "6px 10px 4px",
				fontSize: 10,
				color: "var(--t3)",
				fontWeight: 600,
				textTransform: "uppercase",
				letterSpacing: "0.06em",
			}}
		>
			{children}
		</div>
	);
}

function Dropdown({ children }: { children: React.ReactNode }) {
	return (
		<div
			style={{
				position: "absolute",
				top: "calc(100% + 4px)",
				left: 0,
				width: 200,
				background: "var(--s2)",
				border: "1px solid var(--b0)",
				borderRadius: 8,
				boxShadow: "0 8px 24px var(--shadow)",
				zIndex: 50,
				paddingBlock: 4,
				maxHeight: 260,
				overflowY: "auto",
			}}
		>
			{children}
		</div>
	);
}

function DropdownItem({
	children,
	selected,
	onClick,
}: {
	children: React.ReactNode;
	selected: boolean;
	onClick: () => void;
}) {
	const [hovered, setHovered] = useState(false);

	return (
		<button
			type="button"
			onClick={onClick}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			style={{
				width: "calc(100% - 8px)",
				margin: "0 4px",
				display: "block",
				padding: "5px 8px",
				textAlign: "left",
				fontSize: 13,
				borderRadius: 5,
				border: "none",
				cursor: "pointer",
				fontFamily: "inherit",
				background: selected ? "var(--s3)" : hovered ? "var(--s3)" : "transparent",
				color: selected ? "var(--amber)" : "var(--t1)",
				transition: "background 100ms, color 100ms",
			}}
		>
			{children}
		</button>
	);
}

// --- Helpers ---

function useClickOutside(ref: React.RefObject<HTMLDivElement | null>, handler: () => void) {
	const savedHandler = useRef(handler);
	savedHandler.current = handler;

	useEffect(() => {
		const listener = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				savedHandler.current();
			}
		};
		document.addEventListener("mousedown", listener);
		return () => document.removeEventListener("mousedown", listener);
	}, [ref]);
}

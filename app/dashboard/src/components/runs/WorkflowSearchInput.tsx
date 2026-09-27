import { useEffect, useRef, useState } from "react";

import { useWorkflows } from "../../api/hooks";
import { useDebounce } from "../../hooks/useDebounce";

interface WorkflowSearchInputProps {
	value: string;
	onChange: (name: string) => void;
}

export function WorkflowSearchInput({ value, onChange }: WorkflowSearchInputProps) {
	const [inputValue, setInputValue] = useState(value);
	const [isOpen, setIsOpen] = useState(false);
	const debouncedInput = useDebounce(inputValue, 300);
	const ref = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const namePrefix = inputValue === value ? undefined : debouncedInput || undefined;
	const { data } = useWorkflows({
		source: "user",
		namePrefix,
		limit: 20,
	});

	useEffect(() => {
		const handler = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				setIsOpen(false);
			}
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, []);

	useEffect(() => {
		if (isOpen) {
			inputRef.current?.focus();
		}
	}, [isOpen]);

	const handleSelect = (name: string) => {
		setInputValue(name);
		onChange(name);
		setIsOpen(false);
	};

	const handleClear = () => {
		setInputValue("");
		onChange("");
		setIsOpen(false);
	};

	return (
		<div ref={ref} style={{ position: "relative" }}>
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: container delegates focus to input child */}
			{/* biome-ignore lint/a11y/noStaticElementInteractions: container delegates focus to input child */}
			<div
				onClick={() => {
					if (!isOpen) {
						setInputValue(value);
						setIsOpen(true);
					}
				}}
				style={{
					display: "flex",
					alignItems: "center",
					gap: 6,
					padding: "7px 11px",
					minHeight: 33,
					background: isOpen ? "var(--s1)" : "var(--s2)",
					border: `1px solid ${isOpen ? "var(--accent-tint-border)" : "transparent"}`,
					borderRadius: "var(--r-control)",
					boxShadow: isOpen ? "0 0 0 3px var(--accent-tint)" : "none",
					cursor: "text",
					transition: "background-color .16s ease, border-color .16s ease, box-shadow .16s ease",
				}}
			>
				{value && !isOpen ? (
					<div style={{ display: "flex", alignItems: "center", gap: 6, flex: "1 1 auto", minWidth: 0 }}>
						{/* A long workflow name truncates. Wrapping would make this field taller
						    than the version select beside it and break the row's baseline. */}
						<span
							title={value}
							style={{
								flex: "1 1 auto",
								minWidth: 0,
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
								fontSize: "var(--field-size)",
								fontFamily: "var(--mono)",
								fontWeight: 500,
								color: "var(--t0)",
							}}
						>
							{value}
						</span>
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								handleClear();
							}}
							style={{
								flexShrink: 0,
								cursor: "pointer",
								color: "var(--t3)",
								fontSize: 13,
								lineHeight: 1,
								background: "none",
								border: "none",
								padding: 0,
								font: "inherit",
							}}
							aria-label="Clear workflow filter"
						>
							×
						</button>
					</div>
				) : (
					<input
						ref={inputRef}
						value={inputValue}
						onChange={(e) => {
							setInputValue(e.target.value);
							if (!isOpen) setIsOpen(true);
							if (!e.target.value) onChange("");
						}}
						onFocus={() => setIsOpen(true)}
						placeholder="Workflow name"
						style={{
							flex: 1,
							minWidth: 60,
							background: "none",
							border: "none",
							outline: "none",
							color: "var(--t0)",
							fontSize: "var(--field-size)",
							fontFamily: "var(--mono)",
							padding: "1px 0",
						}}
					/>
				)}
			</div>

			{isOpen && data?.workflows && data.workflows.length > 0 && (
				<div
					className="anim-in"
					style={{
						position: "absolute",
						top: "calc(100% + 3px)",
						left: 0,
						right: 0,
						background: "var(--s1)",
						border: "1px solid var(--b0)",
						borderRadius: "var(--r-panel)",
						padding: 4,
						zIndex: 50,
						boxShadow: "0 12px 28px -12px var(--shadow), var(--shadow-card)",
						// Whole rows plus half of the next, so a clipped list reads as scrollable
						// rather than cut off. Rows are 29px tall (6px padding + 17px line).
						maxHeight: 6 * 29 + 14 + 8,
						overflowY: "auto",
						overscrollBehavior: "contain",
					}}
				>
					{data.workflows.map((wf) => (
						<button
							type="button"
							key={wf.name}
							onClick={() => handleSelect(wf.name)}
							style={{
								display: "block",
								width: "100%",
								textAlign: "left",
								padding: "6px 10px",
								borderRadius: "var(--r-chip)",
								fontSize: 11.5,
								fontFamily: "var(--mono)",
								color: wf.name === value ? "var(--accent-ink)" : "var(--t1)",
								background: wf.name === value ? "var(--accent-tint)" : "transparent",
								cursor: "pointer",
								transition: "background .12s ease, color .12s ease",
								border: "none",
							}}
						>
							{wf.name}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

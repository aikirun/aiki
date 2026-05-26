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

	const { data } = useWorkflows({
		source: "user",
		namePrefix: debouncedInput || undefined,
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
					if (value) {
						handleClear();
					}
					setIsOpen(true);
				}}
				style={{
					display: "flex",
					alignItems: "center",
					gap: 6,
					padding: "5px 9px",
					minHeight: 30,
					background: "var(--s1)",
					border: `1px solid ${isOpen ? "var(--s3)" : "var(--b0)"}`,
					borderRadius: 6,
					cursor: "text",
					transition: "border-color 0.15s",
				}}
			>
				{value && !isOpen ? (
					<div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
						<span style={{ fontSize: 12, fontFamily: "monospace", fontWeight: 500, color: "var(--t0)" }}>{value}</span>
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								handleClear();
							}}
							style={{
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
							color: "var(--t1)",
							fontSize: 11.5,
							fontFamily: "monospace",
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
						background: "var(--s2)",
						border: "1px solid var(--b0)",
						borderRadius: 7,
						padding: 3,
						zIndex: 50,
						boxShadow: "0 8px 24px rgba(0,0,0,.5)",
						maxHeight: 180,
						overflow: "auto",
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
								borderRadius: 5,
								fontSize: 12,
								fontFamily: "monospace",
								color: wf.name === value ? "var(--t0)" : "var(--t1)",
								background: wf.name === value ? "var(--s3)" : "transparent",
								cursor: "pointer",
								transition: "background 0.1s",
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

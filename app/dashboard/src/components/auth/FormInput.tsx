import type { InputHTMLAttributes } from "react";

import { fieldLabel } from "../common/ui";

interface FormInputProps extends InputHTMLAttributes<HTMLInputElement> {
	label: string;
	error?: string;
}

export function FormInput({ label, error, id, ...props }: FormInputProps) {
	const inputId = id || props.name;

	return (
		<div>
			<label htmlFor={inputId} style={{ ...fieldLabel(), display: "block", marginBottom: 7 }}>
				{label}
			</label>
			<input
				id={inputId}
				style={{
					width: "100%",
					padding: "11px 14px",
					background: "var(--s2)",
					border: `1px solid ${error ? "var(--accent-red)" : "transparent"}`,
					borderRadius: "var(--r-control)",
					fontSize: "var(--field-size-lg)",
					color: "var(--t0)",
					outline: "none",
					fontFamily: "var(--sans)",
					boxSizing: "border-box",
					transition: "background-color .16s ease, border-color .16s ease, box-shadow .16s ease",
				}}
				onFocus={(ev) => {
					ev.currentTarget.style.background = "var(--s1)";
					ev.currentTarget.style.borderColor = "var(--accent-tint-border)";
					ev.currentTarget.style.boxShadow = "0 0 0 3px var(--accent-tint)";
				}}
				onBlur={(ev) => {
					ev.currentTarget.style.background = "var(--s2)";
					ev.currentTarget.style.borderColor = error ? "var(--accent-red)" : "transparent";
					ev.currentTarget.style.boxShadow = "none";
				}}
				{...props}
			/>
			{error && <p style={{ marginTop: 6, fontSize: 12, color: "var(--accent-red)" }}>{error}</p>}
		</div>
	);
}

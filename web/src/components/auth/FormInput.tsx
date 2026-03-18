import type { InputHTMLAttributes } from "react";

interface FormInputProps extends InputHTMLAttributes<HTMLInputElement> {
	label: string;
	error?: string;
}

export function FormInput({ label, error, id, ...props }: FormInputProps) {
	const inputId = id || props.name;

	return (
		<div>
			<label
				htmlFor={inputId}
				style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--t1)", marginBottom: 6 }}
			>
				{label}
			</label>
			<input
				id={inputId}
				style={{
					width: "100%",
					padding: "10px 14px",
					background: "var(--s2)",
					border: `1px solid ${error ? "#F87171" : "var(--b0)"}`,
					borderRadius: 8,
					fontSize: 13,
					color: "var(--t0)",
					outline: "none",
					fontFamily: "inherit",
					boxSizing: "border-box",
				}}
				{...props}
			/>
			{error && <p style={{ marginTop: 6, fontSize: 12, color: "#F87171" }}>{error}</p>}
		</div>
	);
}

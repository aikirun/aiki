import type { InputHTMLAttributes } from "react";

interface FormInputProps extends InputHTMLAttributes<HTMLInputElement> {
	label: string;
	error?: string;
}

export function FormInput({ label, error, id, className = "", ...props }: FormInputProps) {
	const inputId = id || props.name;

	return (
		<div>
			<label htmlFor={inputId} className="block text-sm font-medium text-slate-700 mb-1.5">
				{label}
			</label>
			<input
				id={inputId}
				className={`w-full px-4 py-3 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-aiki-purple focus:border-transparent transition-shadow ${
					error ? "border-red-300 focus:ring-red-500" : ""
				} ${className}`}
				{...props}
			/>
			{error && <p className="mt-1.5 text-sm text-red-600">{error}</p>}
		</div>
	);
}

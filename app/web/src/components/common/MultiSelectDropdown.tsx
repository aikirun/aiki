import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface MultiSelectDropdownProps<T> {
	label: string;
	options: T[];
	selected: T[];
	onChange: (selected: T[]) => void;
	getOptionValue: (option: T) => string;
	getOptionLabel: (option: T) => string;
	className?: string;
}

export function MultiSelectDropdown<T>({
	label,
	options,
	selected,
	onChange,
	getOptionValue,
	getOptionLabel,
	className = "",
}: MultiSelectDropdownProps<T>) {
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

	const selectedValues = useMemo(() => new Set(selected.map(getOptionValue)), [selected, getOptionValue]);
	const allSelected = options.length > 0 && selectedValues.size === options.length;

	const toggleOption = (option: T) => {
		const value = getOptionValue(option);
		if (selectedValues.has(value)) {
			onChange(selected.filter((s) => getOptionValue(s) !== value));
		} else {
			onChange([...selected, option]);
		}
	};

	const toggleAll = () => {
		onChange(allSelected ? [] : [...options]);
	};

	return (
		<div ref={dropdownRef} className={`relative ${className}`}>
			<button
				type="button"
				onClick={() => setIsOpen(!isOpen)}
				aria-haspopup="listbox"
				aria-expanded={isOpen}
				className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-aiki-purple focus:border-transparent min-w-[140px] text-left"
			>
				{selected.length === 0 ? label : `${selected.length} selected`}
			</button>
			{isOpen && options.length > 0 && (
				<div className="absolute top-full right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-10 min-w-[160px] max-h-[300px] overflow-y-auto">
					<button
						type="button"
						onClick={toggleAll}
						className="w-full px-3 py-2 text-left text-sm font-medium text-aiki-purple hover:bg-slate-50 border-b border-slate-100"
					>
						{allSelected ? "Clear All" : "Select All"}
					</button>
					{options.map((option) => {
						const value = getOptionValue(option);
						return (
							<label key={value} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer text-sm">
								<input
									type="checkbox"
									checked={selectedValues.has(value)}
									onChange={() => toggleOption(option)}
									className="rounded border-slate-300 text-aiki-purple focus:ring-aiki-purple"
								/>
								<span className="truncate" title={getOptionLabel(option)}>
									{getOptionLabel(option)}
								</span>
							</label>
						);
					})}
				</div>
			)}
		</div>
	);
}

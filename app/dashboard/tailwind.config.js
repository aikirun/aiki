/** @type {import('tailwindcss').Config} */
export default {
	content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
	theme: {
		extend: {
			colors: {
				aiki: {
					purple: "var(--accent-ink)",
					violet: "#764ba2",
					pink: "#f093fb",
					amber: "#E2A336",
				},
				accent: {
					DEFAULT: "var(--accent)",
					hover: "var(--accent-hover)",
					ink: "var(--accent-ink)",
				},
				b0: "var(--b0)",
				surface: {
					bg: "var(--bg)",
					s1: "var(--s1)",
					s2: "var(--s2)",
					s3: "var(--s3)",
				},
				t: {
					0: "var(--t0)",
					1: "var(--t1)",
					2: "var(--t2)",
					3: "var(--t3)",
				},
				status: {
					scheduled: "var(--accent-purple)",
					queued: "var(--accent-purple)",
					running: "var(--accent-sky)",
					paused: "var(--accent-amber)",
					sleeping: "var(--accent-indigo)",
					"awaiting-event": "var(--accent-pink)",
					"awaiting-retry": "var(--accent-orange)",
					"awaiting-child": "var(--accent-purple)",
					cancelled: "var(--accent-gray)",
					completed: "var(--accent-green)",
					failed: "var(--accent-red)",
				},
			},
			borderRadius: {
				card: "var(--r-card)",
				panel: "var(--r-panel)",
				control: "var(--r-control)",
				chip: "var(--r-chip)",
			},
			fontFamily: {
				sans: ["Archivo", "system-ui", "sans-serif"],
				heading: ["Archivo", "system-ui", "sans-serif"],
				mono: ["ui-monospace", "SF Mono", "SFMono-Regular", "Menlo", "monospace"],
			},
			backgroundImage: {
				"aiki-gradient": "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
				"aiki-gradient-extended": "linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)",
			},
			animation: {
				pulse: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
			},
		},
	},
	plugins: [],
};

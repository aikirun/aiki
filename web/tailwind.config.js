/** @type {import('tailwindcss').Config} */
export default {
	content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
	theme: {
		extend: {
			colors: {
				aiki: {
					purple: "#667eea",
					violet: "#764ba2",
					pink: "#f093fb",
					amber: "#E2A336",
				},
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
					scheduled: "#A78BFA",
					queued: "#C084FC",
					running: "#38BDF8",
					paused: "#FBBF24",
					sleeping: "#818CF8",
					"awaiting-event": "#F472B6",
					"awaiting-retry": "#FB923C",
					"awaiting-child": "#C084FC",
					cancelled: "#6B7280",
					completed: "#34D399",
					failed: "#F87171",
				},
			},
			fontFamily: {
				sans: ["DM Sans", "system-ui", "sans-serif"],
				heading: ["Inter", "system-ui", "sans-serif"],
				mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
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

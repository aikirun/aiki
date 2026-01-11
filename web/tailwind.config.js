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
				},
			},
			fontFamily: {
				sans: ["DM Sans", "system-ui", "sans-serif"],
				heading: ["Inter", "system-ui", "sans-serif"],
			},
			backgroundImage: {
				"aiki-gradient": "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
				"aiki-gradient-extended": "linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)",
			},
		},
	},
	plugins: [],
};

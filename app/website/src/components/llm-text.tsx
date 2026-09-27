/**
 * Renders nothing on the page. Its children stay in the source AST, so they are
 * carried into the processed markdown that feeds `llms.txt`, `llms-full.txt`,
 * and the "Copy Markdown" action. Use it to give text-only consumers a fallback
 * for content that renders visually as an interactive component (e.g. a diagram).
 */
export function LlmText() {
	return null;
}

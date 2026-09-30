const MAX_CODE_POINT = 0x10ffff;
const LAST_CODE_POINT_BEFORE_SURROGATES = 0xd7ff;
const FIRST_CODE_POINT_AFTER_SURROGATES = 0xe000;

/**
 * The least string that sorts after every string starting with `prefix`, in code point order.
 * "send" gives "sene", so `value >= "send" AND value < "sene"` holds exactly for the values starting with "send".
 * Undefined when there is none (the prefix is empty or all U+10FFFF); `value >= prefix` alone is then the match.
 */
export function prefixRangeEnd(prefix: string): string | undefined {
	const characters = Array.from(prefix);
	for (
		let lastCodePoint = characters.pop()?.codePointAt(0);
		lastCodePoint !== undefined;
		lastCodePoint = characters.pop()?.codePointAt(0)
	) {
		if (lastCodePoint === MAX_CODE_POINT) {
			continue;
		}
		const nextCodePoint =
			lastCodePoint === LAST_CODE_POINT_BEFORE_SURROGATES ? FIRST_CODE_POINT_AFTER_SURROGATES : lastCodePoint + 1;
		return `${characters.join("")}${String.fromCodePoint(nextCodePoint)}`;
	}
	return undefined;
}

/**
 * The sorted set of timers and the list of signals. One script touches both, and Redis Cluster
 * runs a script only when its keys hash to one slot.
 *
 * Redis hashes the text inside a key's first `{...}` when that text is not empty, and the whole
 * key otherwise. A key with such a hash tag is used as given, and the signal key shares the tag.
 * A key without one is hashed whole, so the signal key wraps it in braces to hash on the same
 * text, and braces in the key are escaped so they cannot end that tag early.
 */
export function getTimerKeys(key: string): { timersKey: string; signalKey: string } {
	if (hasHashTag(key)) {
		return { timersKey: key, signalKey: `${key}:signal` };
	}

	const timersKey = key.replaceAll("%", "%25").replaceAll("{", "%7B").replaceAll("}", "%7D");
	return { timersKey, signalKey: `{${timersKey}}:signal` };
}

function hasHashTag(key: string): boolean {
	const openingBraceIndex = key.indexOf("{");
	if (openingBraceIndex === -1) {
		return false;
	}
	const closingBraceIndex = key.indexOf("}", openingBraceIndex + 1);
	return closingBraceIndex > openingBraceIndex + 1;
}

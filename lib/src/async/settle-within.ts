/**
 * Awaits `promise` but stops waiting after `timeoutMs`. Returns `true` if the
 * promise settled within the budget, `false` if the timeout elapsed first.
 *
 * The timeout timer is cleared the moment the promise settles, so a promise that
 * finishes early leaves nothing pending on the event loop. A rejection counts as
 * settled and is swallowed: callers racing a deadline against a drain only care
 * whether the work finished, not how it finished.
 */
export function settleWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		const timer = setTimeout(() => resolve(false), timeoutMs);
		const onSettled = (): void => {
			clearTimeout(timer);
			resolve(true);
		};
		promise.then(onSettled, onSettled);
	});
}

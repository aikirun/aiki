/**
 * Symbol key for internal SDK APIs.
 * Used to hide internal methods from user autocomplete while maintaining type safety.
 *
 * @example
 * ```typescript
 * import { INTERNAL } from '@aikirun/lib';
 *
 * class Client {
 *   [INTERNAL]: ClientInternals;
 * }
 * ```
 */
export const INTERNAL: unique symbol = Symbol("aiki.internal");

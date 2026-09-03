declare const opaque: unique symbol;

/** A payload as the server stores it. The server never reads inside it. */
export type OpaquePayload = { readonly [opaque]: true };

declare const opaque: unique symbol;

export type OpaquePayload = { readonly [opaque]: true };

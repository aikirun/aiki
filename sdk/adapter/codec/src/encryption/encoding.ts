// 32 KB chunks keep `String.fromCharCode(...chunk)` under the call-stack / arg limit.
const BYTES_TO_BASE64_CHUNK_SIZE = 0x8000;

type Uint8ArrayBase64 = {
	toBase64: (options?: { alphabet?: "base64" | "base64url"; omitPadding?: boolean }) => string;
};

type Uint8ArrayConstructorBase64 = {
	fromBase64: (base64: string, options?: { alphabet?: "base64" | "base64url" }) => Uint8Array;
};

export function bytesToBase64(bytes: Uint8Array): string {
	const { toBase64 } = bytes as Uint8Array & Partial<Uint8ArrayBase64>;
	if (typeof toBase64 === "function") {
		return toBase64.call(bytes);
	}

	if (typeof Buffer !== "undefined") {
		return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
	}

	let binary = "";
	for (let i = 0; i < bytes.length; i += BYTES_TO_BASE64_CHUNK_SIZE) {
		binary += String.fromCharCode(...bytes.subarray(i, i + BYTES_TO_BASE64_CHUNK_SIZE));
	}

	return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
	const { fromBase64 } = Uint8Array as typeof Uint8Array & Partial<Uint8ArrayConstructorBase64>;
	if (typeof fromBase64 === "function") {
		return fromBase64(base64);
	}

	if (typeof Buffer !== "undefined") {
		const buffer = Buffer.from(base64, "base64");
		return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
	}

	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}

	return bytes;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
	const { toBase64 } = bytes as Uint8Array & Partial<Uint8ArrayBase64>;

	if (typeof toBase64 === "function") {
		return toBase64.call(bytes, { alphabet: "base64url", omitPadding: true });
	}

	if (typeof Buffer !== "undefined") {
		return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64url");
	}

	return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

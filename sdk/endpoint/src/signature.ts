const encoder = new TextEncoder();

export async function verifySignature(params: {
	header: string;
	body: string;
	secret: string;
	signatureMaxAgeMs: number;
}): Promise<boolean> {
	const { header, body, secret, signatureMaxAgeMs } = params;

	const parsed = parseSignatureHeader(header);
	if (!parsed) {
		return false;
	}

	const { timestamp, signature } = parsed;

	const age = Date.now() - timestamp;
	if (age < 0 || age > signatureMaxAgeMs) {
		return false;
	}

	const signedPayload = `${timestamp}.${body}`;
	const expectedSignature = await computeHmac(secret, signedPayload);

	return timingSafeEqual(signature, expectedSignature);
}

function parseSignatureHeader(header: string): { timestamp: number; signature: string } | null {
	let timestamp: number | undefined;
	let signature: string | undefined;

	for (const part of header.split(",")) {
		const [key, value] = part.split("=", 2);
		if (!key || !value) {
			return null;
		}

		const trimmedKey = key.trim();
		if (trimmedKey === "t") {
			timestamp = Number(value.trim());
			if (!Number.isFinite(timestamp)) {
				return null;
			}
		} else if (trimmedKey === "v1") {
			signature = value.trim();
		}
	}

	if (timestamp === undefined || signature === undefined) {
		return null;
	}

	return { timestamp, signature };
}

async function computeHmac(secret: string, payload: string): Promise<string> {
	const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
		"sign",
	]);

	const signatureBuffer = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
	const signatureArray = new Uint8Array(signatureBuffer);

	let hex = "";
	for (const byte of signatureArray) {
		hex += byte.toString(16).padStart(2, "0");
	}
	return hex;
}

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) {
		return false;
	}

	let result = 0;
	for (let i = 0; i < b.length; i++) {
		result |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return result === 0;
}

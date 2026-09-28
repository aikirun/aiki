import { createHmac } from "node:crypto";

import { verifySignature } from "./signature";
import { describe, expect, test } from "bun:test";

const SECRET = "endpoint-secret";
const BODY = JSON.stringify({ workflowRunId: "run-1" });
const NO_SIGNATURE_EXPIRES_MS = Number.MAX_SAFE_INTEGER;

function sign(secret: string, timestamp: number, body: string): string {
	return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

describe("verifySignature", () => {
	test("accepts a signature over the timestamp and body made with the shared secret", async () => {
		const header = `t=1,v1=${sign(SECRET, 1, BODY)}`;

		expect(
			await verifySignature({ header, body: BODY, secret: SECRET, signatureMaxAgeMs: NO_SIGNATURE_EXPIRES_MS })
		).toBe(true);
	});

	test("accepts header parts in any order and with surrounding spaces", async () => {
		const header = ` v1 = ${sign(SECRET, 1, BODY)} , t = 1 `;

		expect(
			await verifySignature({ header, body: BODY, secret: SECRET, signatureMaxAgeMs: NO_SIGNATURE_EXPIRES_MS })
		).toBe(true);
	});

	test("ignores header parts it does not recognise", async () => {
		const header = `t=1,v0=unused,v1=${sign(SECRET, 1, BODY)}`;

		expect(
			await verifySignature({ header, body: BODY, secret: SECRET, signatureMaxAgeMs: NO_SIGNATURE_EXPIRES_MS })
		).toBe(true);
	});

	test("rejects a signature made with a different secret", async () => {
		const header = `t=1,v1=${sign("other-secret", 1, BODY)}`;

		expect(
			await verifySignature({ header, body: BODY, secret: SECRET, signatureMaxAgeMs: NO_SIGNATURE_EXPIRES_MS })
		).toBe(false);
	});

	test("rejects a body that differs from the signed body", async () => {
		const header = `t=1,v1=${sign(SECRET, 1, BODY)}`;
		const changedBody = JSON.stringify({ workflowRunId: "run-2" });

		expect(
			await verifySignature({
				header,
				body: changedBody,
				secret: SECRET,
				signatureMaxAgeMs: NO_SIGNATURE_EXPIRES_MS,
			})
		).toBe(false);
	});

	test("rejects a timestamp that differs from the signed timestamp", async () => {
		const header = `t=2,v1=${sign(SECRET, 1, BODY)}`;

		expect(
			await verifySignature({ header, body: BODY, secret: SECRET, signatureMaxAgeMs: NO_SIGNATURE_EXPIRES_MS })
		).toBe(false);
	});

	test("rejects a signature older than the max age", async () => {
		const header = `t=1,v1=${sign(SECRET, 1, BODY)}`;

		expect(await verifySignature({ header, body: BODY, secret: SECRET, signatureMaxAgeMs: 60_000 })).toBe(false);
	});

	test("rejects a signature timestamped in the future", async () => {
		// The clock cannot be pinned in unit tests (files run concurrently), so "in the future" is
		// a timestamp a day out — far beyond the lifetime of a test run.
		const futureTimestamp = Date.now() + 24 * 60 * 60 * 1000;
		const header = `t=${futureTimestamp},v1=${sign(SECRET, futureTimestamp, BODY)}`;

		expect(
			await verifySignature({ header, body: BODY, secret: SECRET, signatureMaxAgeMs: NO_SIGNATURE_EXPIRES_MS })
		).toBe(false);
	});

	test("rejects the expected signature with extra characters appended", async () => {
		const header = `t=1,v1=${sign(SECRET, 1, BODY)}00`;

		expect(
			await verifySignature({ header, body: BODY, secret: SECRET, signatureMaxAgeMs: NO_SIGNATURE_EXPIRES_MS })
		).toBe(false);
	});

	describe("rejects a malformed header", () => {
		const validSignature = sign(SECRET, 1, BODY);
		const malformedHeaders = {
			"an empty header": "",
			"a missing timestamp": `v1=${validSignature}`,
			"a missing signature": "t=1",
			"a non-numeric timestamp": `t=soon,v1=${validSignature}`,
			"a part without a value": `t=1,v1=${validSignature},v0`,
			"a part with an empty value": `t=,v1=${validSignature}`,
		};

		for (const [description, header] of Object.entries(malformedHeaders)) {
			test(`with ${description}`, async () => {
				expect(
					await verifySignature({
						header,
						body: BODY,
						secret: SECRET,
						signatureMaxAgeMs: NO_SIGNATURE_EXPIRES_MS,
					})
				).toBe(false);
			});
		}
	});
});

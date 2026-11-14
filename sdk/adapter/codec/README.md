# @aikirun/codec

Codec adapter for Aiki clients. A codec runs over workflow input, task input and output, workflow output, event data, and schedule input before they leave the process, and decodes on the way back — so the server only ever sees the encoded form.

## Installation

```bash
npm install @aikirun/codec
```

## Quick Start

### `codec()`

Wraps each encoded payload as `{ codecName, body }` and unwraps that envelope on decode, so the stored form always records which codec produced it:

```typescript
import { client } from "@aikirun/client";
import { codec } from "@aikirun/codec";

const myCodec = codec({
	name: "aes-256-gcm",
	encode: (payload) => encryptWithKey(payload),
	decode: (encoded) => decryptWithKey(encoded),
});

const aiki = client({
	url: "http://localhost:9876",
	codec: myCodec,
});
```

### `pipeCodecs()`

Runs codecs in order on encode and reverses them on decode — for example compress, then encrypt, then offload:

```typescript
import { codec, pipeCodecs } from "@aikirun/codec";

const stacked = pipeCodecs(compress, encrypt, offloadToS3);
```

### `switchCodecs()`

Always encodes with the current codec. On decode it reads the stored `codecName` and runs only the member that wrote that value, so you can roll forward while still reading payloads written by deprecated codecs:

```typescript
import { codec, switchCodecs } from "@aikirun/codec";

const v1 = codec({ name: "v1", encode, decode });
const v2 = codec({ name: "v2", encode: encodeV2, decode: decodeV2 });

const migrating = switchCodecs({
	current: v2,
	deprecated: [v1],
});
```

### `encryption()`

Builds an AES-256-GCM codec and a matching keyed HMAC-SHA-256 hasher.
Because AES-GCM ciphertexts are non-deterministic and the server never sees plaintext, the client must supply both codec (for payload encryption) and hasher (for deterministic run deduplication and task input hashing).
The key resolver accepts a `keyId` and returns 32-byte master key material (sync or async, returning `null` if not found). AES-GCM and HMAC keys are derived from it using HKDF-SHA-256 under distinct info labels:

```typescript
import { client } from "@aikirun/client";
import { encryption } from "@aikirun/codec";

const keys = new Map<string, Uint8Array>([["2025-01", rawKey]]);

const { codec, hasher } = encryption({
	name: "AES-256-GCM",
	key: (keyId) => keys.get(keyId) ?? null,
	config: { keyId: "2025-01" },
});

const aiki = client({
	url: "http://localhost:9876",
	codec,
	hasher,
});
```

#### Key Rotation

Payloads and hashes record the `keyId` that produced them, so historical data continues to decrypt as long as the resolver serves that key ID.

To rotate keys without downtime (for example, to "2025-02"):

1. Pre-announce: Set `nextKeyId`: "2025-02" in config so the hasher signs with both keys.
2. Promote: Switch keyId: "2025-02" and move the old key into previousKeyIds: ["2025-01"].
3. Retire: Drop "2025-01" from `previousKeyIds` once active runs complete. Keep the key in your resolver to decrypt archived payloads.

Scheme changes (such as switching algorithms or envelope formats) should use a second `encryption()` and `switchCodecs()`.

## Documentation

See the client docs (TBA) for how codecs bind to runs and workers.

## License

Apache-2.0

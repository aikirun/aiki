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

Builds an AES-256-GCM codec and a matching keyed hasher. Pass both to the client. The resolver returns 32-byte master material per key id; AES-GCM and HMAC-SHA-256 keys are derived from it with HKDF-SHA-256 under distinct info labels. Key rotation is config only — each stored value and hash names its own key id, and the resolver answers for that id:

```typescript
import { client } from "@aikirun/client";
import { encryption } from "@aikirun/codec";

const keys = new Map<string, Uint8Array>([["2025-01", rawKey]]);

const { codec, hasher } = encryption({
	algorithm: "AES-256-GCM",
	key: (keyId) => keys.get(keyId) ?? null,
	config: { keyId: "2025-01" },
});

const aiki = client({
	url: "http://localhost:9876",
	codec,
	hasher,
});
```

Announce a rotation with `nextKeyId` / `previousKeyIds` on the config (or a config provider read on each encode). Scheme changes — a new algorithm or envelope — use a second `encryption()` (or `codec()`) and `switchCodecs`.

## Documentation

See the client docs (TBA) for how codecs bind to runs and workers.

## License

Apache-2.0

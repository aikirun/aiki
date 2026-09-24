# @aikirun/codec

Codec adapter for Aiki clients. A codec runs over workflow input, task input and output, workflow output, event data, and schedule input before they leave the process, and decodes on the way back — so the server only ever sees the encoded form.

## Installation

```bash
npm install @aikirun/codec
```

## Quick Start

`codec()` wraps each encoded payload as `{ codecName, body }` and unwraps that envelope on decode, so the stored form always records which codec produced it:

```typescript
import { client } from "@aikirun/client";
import { codec } from "@aikirun/codec";

const myCodec = codec({
	name: "aes-256-gcm",
	encode: (payload) => encryptWithKey(payload),
	decode: (body) => decryptWithKey(body),
});

const aiki = client({
	url: "http://localhost:9876",
	codec: myCodec,
});
```

`pipeCodecs()` runs codecs in order on encode and reverses them on decode — for example compress, then encrypt, then offload:

```typescript
import { codec, pipeCodecs } from "@aikirun/codec";

const stacked = pipeCodecs(compress, encrypt, offloadToS3);
```

`switchCodecs()` always encodes with the current codec. On decode it reads the stored `codecName` and runs only the member that wrote that value, so you can roll forward while still reading payloads written by deprecated codecs:

```typescript
import { codec, switchCodecs } from "@aikirun/codec";

const v1 = codec({ name: "v1", encode, decode });
const v2 = codec({ name: "v2", encode: encodeV2, decode: decodeV2 });

const migrating = switchCodecs({
	current: v2,
	deprecated: [v1],
});
```

## Documentation

See the client docs (TBA) for how codecs bind to runs and workers.

## License

Apache-2.0

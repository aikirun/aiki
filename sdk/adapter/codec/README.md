# @aikirun/codec

Codec adapter for Aiki clients. A codec runs over workflow input, task input and output, workflow output, event data, and schedule input before they leave the process, and decodes on the way back — so the server only ever sees the encoded form.

## Installation

```bash
npm install @aikirun/codec
```

## Quick Start

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

`codec()` wraps each encoded payload as `{ codecName, body }` and unwraps that envelope on decode, so the stored form always records which codec produced it.

## Documentation

See the [client](https://aiki.run/docs) docs for how codecs bind to runs and workers.

## License

Apache-2.0

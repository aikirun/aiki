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

Encrypts payloads with AES-256-GCM, so the server only ever stores ciphertext.

```typescript
import { client } from "@aikirun/client";
import { encryption } from "@aikirun/codec";

const keys = new Map<string, Uint8Array>([["2025-01", key2025_01]]);

const { codec, hasher } = encryption({
	name: "app-encryption",
	key: (keyId) => keys.get(keyId) ?? null,
	config: { keyId: "2025-01" },
});

const aiki = client({ url: "http://localhost:9876", codec, hasher });
```

- `key` looks up a key by its ID. A key is 32 random bytes, kept in your secret store. Return `null` for an ID you don't have. The lookup can be async, for example, a call to your KMS.
- `config.keyId` is the ID of the key that encrypts new values. Each encrypted value records that ID, so it can still be decrypted after you move to a newer key.
- `name` is stored with every encrypted value and at the start of every hash. Keep it once chosen: a new name changes every hash, so Aiki would treat inputs hashed under the old name as different inputs. If you later replace this codec, keep it as a `deprecated` member of `switchCodecs()` so the values it wrote still decode.

Pass both `codec` and `hasher` to every client: the ones that start workflows or send events, and the ones your workers use.

The hasher matters because Aiki stores a hash of each workflow and task input on the server. It uses the hash to recognise an input it has seen before, such as a task on replay, or a start with a reference ID it already knows. By default the hash is plain SHA-256, which anyone can compute, so a guessable input like an email address can be found by hashing guesses. `hasher` computes it with your key instead, so the stored hashes don't reveal inputs.

#### Key Rotation

You encrypt with "2025-01" today:

```typescript
config: { keyId: "2025-01" }
```

To move to the new key ID "2025-02":

1. Add "2025-02" to your key store, so the `key` function returns it in every process that uses this client: your app servers and your workers.
2. Announce it in every process:

   ```typescript
   config: { keyId: "2025-01", nextKeyId: "2025-02" }
   ```
   
3. Once every process has the announcement, switch:

   ```typescript
   config: { keyId: "2025-02", previousKeyIds: ["2025-01"] }
   ```

	New values are now encrypted with "2025-02". Values encrypted with "2025-01" still decrypt as long as the `key` function returns it, so keep it in your key store.
	
4. Keep "2025-01" in `previousKeyIds` for as long as inputs from before the switch should count as the same input.

Why these steps: Aiki recognises an input by its hash, and the same input hashed with another key gets another hash. While a key is listed in `nextKeyId` or `previousKeyIds`, the hasher also makes hashes with it, so Aiki still recognises inputs hashed with that key. Announcing first lets every process recognise "2025-02" before any process starts using it.

Once "2025-01" is dropped from `previousKeyIds`, Aiki can't tell that an input hashed with it is the same as that input hashed with "2025-02", so it treats them as different inputs. Calling `activate()` for a schedule you haven't activated since the switch then creates a new schedule, and starting a workflow with a reference ID used before the switch gets the conflict policy's answer, as it would for a different input.

## Documentation

See the client docs (TBA) for how codecs bind to runs and workers.

## License

Apache-2.0

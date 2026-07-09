FROM oven/bun:1.3.4 AS builder

WORKDIR /aiki

COPY package.json bun.lock ./
COPY lib/package.json ./lib/
COPY types/package.json ./types/
COPY sdk/client/package.json ./sdk/client/
COPY sdk/endpoint/package.json ./sdk/endpoint/
COPY sdk/adapter/http/package.json ./sdk/adapter/http/
COPY sdk/adapter/memory/package.json ./sdk/adapter/memory/
COPY sdk/adapter/redis/package.json ./sdk/adapter/redis/
COPY sdk/iam/package.json ./sdk/iam/
COPY sdk/server/package.json ./sdk/server/
COPY sdk/worker/package.json ./sdk/worker/
COPY sdk/workflow/package.json ./sdk/workflow/
COPY cli/package.json ./cli/
COPY app/server/package.json ./app/server/
COPY app/dashboard/package.json ./app/dashboard/
COPY examples/package.json ./examples/
COPY testing/package.json ./testing/

RUN bun install --frozen-lockfile

COPY lib/ ./lib/
COPY types/ ./types/
COPY sdk/adapter/redis/ ./sdk/adapter/redis/
COPY sdk/iam/ ./sdk/iam/
COPY sdk/server/ ./sdk/server/
COPY app/server/ ./app/server/
COPY cli/ ./cli/
COPY tsconfig.json ./

ARG TARGETARCH
RUN cd cli \
	&& bun scripts/generate-embedded-data.ts \
	&& target="bun-linux-x64-musl" \
	&& if [ "$TARGETARCH" = "arm64" ]; then target="bun-linux-arm64-musl"; fi \
	&& bun build src/index.ts --compile --target="$target" --outfile dist/aiki

FROM alpine:3

RUN apk add --no-cache libstdc++

COPY --from=builder /aiki/cli/dist/aiki /usr/local/bin/aiki

ENTRYPOINT ["aiki"]
CMD ["--help"]

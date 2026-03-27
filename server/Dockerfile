FROM oven/bun:1 AS builder

WORKDIR /app

COPY package.json bun.lock ./
COPY lib/package.json ./lib/
COPY types/package.json ./types/
COPY server/package.json ./server/
COPY sdk/client/package.json ./sdk/client/
COPY sdk/endpoint/package.json ./sdk/endpoint/
COPY sdk/subscriber/http/package.json ./sdk/subscriber/http/
COPY sdk/subscriber/redis/package.json ./sdk/subscriber/redis/
COPY sdk/worker/package.json ./sdk/worker/
COPY sdk/workflow/package.json ./sdk/workflow/
COPY web/package.json ./web/
COPY examples/package.json ./examples/

RUN bun install --frozen-lockfile

COPY lib/ ./lib/
COPY types/ ./types/
COPY server/ ./server/
COPY tsconfig.json ./

RUN bunx tsc --noEmit
RUN bun run build:server

FROM gcr.io/distroless/cc-debian12

ARG AIKI_SERVER_PORT=9850
ENV AIKI_SERVER_PORT=${AIKI_SERVER_PORT}

WORKDIR /app
COPY --from=builder /app/server/dist/aiki-server ./

EXPOSE ${AIKI_SERVER_PORT}
CMD ["./aiki-server"]

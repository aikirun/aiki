FROM oven/bun:1 AS builder

WORKDIR /aiki

COPY package.json bun.lock ./
COPY lib/package.json ./lib/
COPY types/package.json ./types/
COPY sdk/client/package.json ./sdk/client/
COPY sdk/endpoint/package.json ./sdk/endpoint/
COPY sdk/adapter/http/package.json ./sdk/adapter/http/
COPY sdk/adapter/redis/package.json ./sdk/adapter/redis/
COPY sdk/iam/package.json ./sdk/iam/
COPY sdk/server/package.json ./sdk/server/
COPY sdk/worker/package.json ./sdk/worker/
COPY sdk/workflow/package.json ./sdk/workflow/
COPY cli/package.json ./cli/
COPY app/server/package.json ./app/server/
COPY app/web/package.json ./app/web/
COPY examples/package.json ./examples/

RUN bun install --frozen-lockfile

COPY lib/ ./lib/
COPY types/ ./types/
COPY sdk/adapter/redis/ ./sdk/adapter/redis/
COPY sdk/iam/ ./sdk/iam/
COPY sdk/server/ ./sdk/server/
COPY app/server/ ./app/server/
COPY tsconfig.json ./

RUN bunx tsc --noEmit
RUN bun run build:server

FROM gcr.io/distroless/cc-debian12

ARG AIKI_SERVER_PORT=9850
ENV AIKI_SERVER_PORT=${AIKI_SERVER_PORT}

WORKDIR /aiki/app
COPY --from=builder /aiki/app/server/dist/aiki-server ./

EXPOSE ${AIKI_SERVER_PORT}
CMD ["./aiki-server"]

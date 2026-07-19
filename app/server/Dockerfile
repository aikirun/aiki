FROM oven/bun:1.3.14 AS builder

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
COPY app/website/package.json ./app/website/
COPY examples/package.json ./examples/
COPY testing/package.json ./testing/

RUN bun install --frozen-lockfile

COPY lib/ ./lib/
COPY types/ ./types/
COPY sdk/adapter/memory/ ./sdk/adapter/memory/
COPY sdk/adapter/redis/ ./sdk/adapter/redis/
COPY sdk/iam/ ./sdk/iam/
COPY sdk/server/ ./sdk/server/
COPY app/server/ ./app/server/
COPY tsconfig.json ./

RUN bunx tsc --noEmit

WORKDIR /aiki/app/server
RUN bun run build

FROM gcr.io/distroless/cc-debian12

ARG AIKI_SERVER_PORT=9850
ENV AIKI_SERVER_PORT=${AIKI_SERVER_PORT}

WORKDIR /aiki/app
COPY --from=builder /aiki/app/server/dist/aiki-app-server ./

EXPOSE ${AIKI_SERVER_PORT}
CMD ["./aiki-app-server"]

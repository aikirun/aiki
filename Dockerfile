FROM oven/bun:1 AS builder

WORKDIR /app

COPY package.json bun.lock ./
COPY lib/package.json ./lib/
COPY types/package.json ./types/
COPY server/package.json ./server/
COPY sdk/client/package.json ./sdk/client/
COPY sdk/task/package.json ./sdk/task/
COPY sdk/worker/package.json ./sdk/worker/
COPY sdk/workflow/package.json ./sdk/workflow/

RUN bun install --frozen-lockfile

COPY lib/ ./lib/
COPY types/ ./types/
COPY server/ ./server/
COPY tsconfig.json ./

RUN bun run check
RUN bun run build:server

FROM gcr.io/distroless/cc-debian12

ARG AIKI_PORT=9876
ENV AIKI_PORT=${AIKI_PORT}

WORKDIR /app
COPY --from=builder /app/server/dist/aiki-server ./

EXPOSE ${AIKI_PORT}
CMD ["./aiki-server"]

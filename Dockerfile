FROM oven/bun:1

ARG AIKI_PORT=9090
ENV AIKI_PORT=${AIKI_PORT}

WORKDIR /app

COPY package.json bun.lock ./
COPY lib/package.json ./lib/
COPY types/package.json ./types/
COPY server/package.json ./server/

RUN bun install --frozen-lockfile

COPY lib/ ./lib/
COPY types/ ./types/
COPY server/ ./server/
COPY tsconfig.json ./

RUN bun run check

EXPOSE ${AIKI_PORT}

CMD ["bun", "run", "server"]

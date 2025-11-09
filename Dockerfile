FROM denoland/deno:latest

ARG AIKI_PORT=9090
ENV AIKI_PORT=${AIKI_PORT}

WORKDIR /app

COPY server/ ./server/
COPY lib/ ./lib/
COPY types/ ./types/
COPY deno.json ./
COPY deno.lock ./

RUN deno check server/server.ts

RUN useradd -m -u 1000 deno
RUN chown -R deno:deno /app
USER deno

EXPOSE ${AIKI_PORT}

CMD ["deno", "run", "--allow-net", "--allow-read", "--allow-env", "server/server.ts"]

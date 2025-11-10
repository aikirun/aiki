FROM denoland/deno:latest

ARG AIKI_PORT=9090
ENV AIKI_PORT=${AIKI_PORT}

WORKDIR /server

COPY server/ ./

RUN deno add jsr:@aikirun/lib jsr:@aikirun/types

RUN deno check server.ts

RUN id deno > /dev/null 2>&1 || useradd -m -u 1000 deno
RUN chown -R deno:deno /server
USER deno

EXPOSE ${AIKI_PORT}

CMD ["deno", "run", "--allow-net", "--allow-read", "--allow-env", "server.ts"]

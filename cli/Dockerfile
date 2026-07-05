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
COPY examples/package.json ./examples/
COPY testing/package.json ./testing/

RUN bun install --frozen-lockfile

COPY lib/ ./lib/
COPY types/ ./types/
COPY sdk/adapter/memory/ ./sdk/adapter/memory/
COPY sdk/iam/ ./sdk/iam/
COPY sdk/server/ ./sdk/server/
COPY cli/ ./cli/
COPY tsconfig.json ./

RUN bunx tsc --noEmit

# Building @aikirun/server and @aikirun/iam places their migration files in
# dist/, where `aiki migrate apply` resolves them from the workspace packages
RUN bun run --cwd lib build \
	&& bun run --cwd types build \
	&& bun run --cwd sdk/server build \
	&& bun run --cwd sdk/iam build \
	&& bun run --cwd cli build

FROM oven/bun:1.3.14-alpine

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

# --ignore-scripts: the root prepare script runs husky, a devDependency absent
# from a production install; no runtime dependency here needs install scripts
RUN bun install --frozen-lockfile --production --ignore-scripts --filter '@aikirun/cli'

COPY --from=builder /aiki/types/dist ./types/dist
COPY --from=builder /aiki/sdk/server/dist ./sdk/server/dist
COPY --from=builder /aiki/sdk/iam/dist ./sdk/iam/dist
COPY --from=builder /aiki/cli/dist ./cli/dist

RUN printf '#!/bin/sh\nexec bun /aiki/cli/dist/index.js "$@"\n' > /usr/local/bin/aiki \
	&& chmod +x /usr/local/bin/aiki

ENTRYPOINT ["aiki"]
CMD ["--help"]

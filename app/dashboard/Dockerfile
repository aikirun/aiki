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
COPY app/dashboard/package.json ./app/dashboard/
COPY examples/package.json ./examples/

RUN bun install --frozen-lockfile

COPY lib/ ./lib/
COPY types/ ./types/
COPY sdk/iam/ ./sdk/iam/
COPY app/dashboard/ ./app/dashboard/
COPY tsconfig.json ./

RUN bun run --cwd types build

ARG VITE_AIKI_SERVER_URL
ENV VITE_AIKI_SERVER_URL=${VITE_AIKI_SERVER_URL}

WORKDIR /aiki/app/dashboard
RUN bun run build

FROM nginx:alpine

COPY --from=builder /aiki/app/dashboard/dist /usr/share/nginx/html
COPY app/dashboard/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 9851
CMD ["nginx", "-g", "daemon off;"]

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
COPY web/package.json ./web/

RUN bun install --frozen-lockfile

COPY types/ ./types/
COPY web/ ./web/
COPY tsconfig.json ./

RUN bun run --cwd types build

ARG VITE_AIKI_SERVER_URL
ENV VITE_AIKI_SERVER_URL=${VITE_AIKI_SERVER_URL}

WORKDIR /app/web
RUN bun run build

FROM nginx:alpine

COPY --from=builder /app/web/dist /usr/share/nginx/html
COPY web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 9851
CMD ["nginx", "-g", "daemon off;"]

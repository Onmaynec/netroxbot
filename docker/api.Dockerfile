FROM node:24.21.0-alpine

WORKDIR /app
RUN corepack enable

COPY . .
RUN pnpm install --no-frozen-lockfile
RUN pnpm --filter @netrox/api build

CMD ["pnpm", "--filter", "@netrox/api", "start"]

FROM node:24.21.0-alpine

WORKDIR /app
RUN corepack enable

COPY . .
RUN pnpm install --no-frozen-lockfile
RUN pnpm --filter @netrox/dashboard build

EXPOSE 3000
CMD ["pnpm", "--filter", "@netrox/dashboard", "start"]

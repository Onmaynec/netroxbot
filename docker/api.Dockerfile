FROM node:24.21.0-alpine

WORKDIR /app
RUN corepack enable

COPY . .
RUN pnpm install --no-frozen-lockfile
RUN pnpm db:generate
RUN pnpm build

EXPOSE 3001
CMD ["sh", "scripts/start-service.sh", "@netrox/api"]

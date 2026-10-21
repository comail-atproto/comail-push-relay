FROM node:22.23.4-alpine@sha256:ce8d97f7cfc7c5386421eb932df20a29df99b1a7f469f6157d5c9956702ffadc AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --no-audit --no-fund
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:22.23.4-alpine@sha256:ce8d97f7cfc7c5386421eb932df20a29df99b1a7f469f6157d5c9956702ffadc AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PUSH_DATA_DIR=/app/data
ENV PORT=3003

RUN addgroup -S relay && adduser -S relay -G relay
COPY package.json package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data && chown -R relay:relay /app

USER relay
EXPOSE 3003
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:3003/api/health || exit 1
CMD ["node", "dist/server.js"]

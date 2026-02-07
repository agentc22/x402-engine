FROM node:22-slim AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
COPY config/ config/
RUN npm run build

FROM node:22-slim

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist dist/
COPY config/ config/
COPY public/ public/

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3402

EXPOSE 3402

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://localhost:3402/health').then(r => process.exit(r.ok ? 0 : 1))"

CMD ["node", "dist/index.js"]

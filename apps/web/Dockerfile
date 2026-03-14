FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package.json
COPY apps/web/package.json apps/web/package.json
RUN npm install

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/package.json ./apps/web/package.json
COPY . .
RUN npm run build --workspace @splashtrack/web

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/web .
EXPOSE 3000
CMD ["npm", "run", "start"]

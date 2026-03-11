FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_API_BASE_URL=""
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# Next.js standalone binds to the container hostname by default;
# set HOSTNAME=0.0.0.0 so it listens on all interfaces.
ENV HOSTNAME=0.0.0.0
# Standalone output: self-contained server.js + minimal node_modules
COPY --from=build /app/.next/standalone ./
# Static assets and public files are not included in standalone by default
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]

# Next.js standalone build → tiny runtime image.
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

FROM node:20-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Next.js evaluates ``next.config.js`` rewrites at *build time*, baking the
# ``destination`` string into the standalone server bundle. So the proxy
# target must be known here, not at runtime. The compose file passes
# ``http://api:8000`` (the in-network service name); for stand-alone builds
# we leave it unset and the config falls back to ``http://localhost:8000``.
ARG API_PROXY_TARGET
ENV API_PROXY_TARGET=$API_PROXY_TARGET
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=5174
ENV HOSTNAME=0.0.0.0

# Standalone output bundles only what the server actually imports.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

EXPOSE 5174
CMD ["node", "server.js"]

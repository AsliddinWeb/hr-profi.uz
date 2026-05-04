# Multi-stage: build with Node, serve with nginx.
ARG VITE_API_URL=/api/v1
ARG VITE_WS_URL=/ws

FROM node:20-alpine AS build
WORKDIR /app
ENV CI=true

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY . .
ARG VITE_API_URL
ARG VITE_WS_URL
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

# nginx default CMD is fine.

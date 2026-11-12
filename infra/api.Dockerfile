FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/web ./apps/web
RUN npm ci --workspace packages/reference --workspace packages/domain --workspace apps/api --workspace apps/web --include-workspace-root \
 && npm run build
ENV NODE_ENV=production
EXPOSE 8080

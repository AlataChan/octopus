# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
RUN corepack enable
WORKDIR /opt/octopus

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json vitest.config.ts eslint.config.js .prettierrc .editorconfig README.md ./
COPY packages ./packages
COPY docs ./docs
COPY ops ./ops

RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:22-bookworm-slim AS gateway-runner
ENV NODE_ENV=production
WORKDIR /workspace

COPY --from=build /opt/octopus /opt/octopus

EXPOSE 4321

CMD ["sh", "-c", "node /opt/octopus/packages/surfaces-cli/dist/index.js gateway run --profile ${OCTOPUS_PROFILE:-vibe}"]

FROM nginx:1.27-alpine AS web-runner
COPY ops/nginx/release.conf /etc/nginx/conf.d/default.conf
COPY --from=build /opt/octopus/packages/surfaces-web/dist /usr/share/nginx/html

EXPOSE 80

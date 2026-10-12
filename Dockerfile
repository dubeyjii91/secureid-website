FROM node:24-alpine
WORKDIR /app
RUN apk add --no-cache su-exec && chown node:node /app
USER node
COPY --chown=node:node package*.json ./
RUN npm install --include=dev --no-audit --no-fund
COPY --chown=node:node . .
RUN npm run build
COPY --chown=node:node --chmod=755 scripts/docker-entrypoint.sh /usr/local/bin/secureid-entrypoint
ENV NODE_ENV=production
ENV RAILWAY_RUN_UID=0
EXPOSE 8080
ENTRYPOINT ["secureid-entrypoint"]
CMD ["npm","start"]

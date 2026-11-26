FROM node:24-alpine3.22
WORKDIR /app
RUN apk add --no-cache su-exec poppler-utils tesseract-ocr tesseract-ocr-data-eng tesseract-ocr-data-hin \
    && tesseract --list-langs 2>/dev/null | grep -qx eng \
    && tesseract --list-langs 2>/dev/null | grep -qx hin \
    && pdftotext -v >/dev/null 2>&1 \
    && pdftoppm -v >/dev/null 2>&1 \
    && chown node:node /app
USER node
COPY --chown=node:node package*.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY --chown=node:node . .
RUN npm run build
COPY --chown=node:node --chmod=755 scripts/docker-entrypoint.sh /usr/local/bin/secureid-entrypoint
ENV NODE_ENV=production
ENV RAILWAY_RUN_UID=0
EXPOSE 8080
ENTRYPOINT ["secureid-entrypoint"]
CMD ["npm","start"]

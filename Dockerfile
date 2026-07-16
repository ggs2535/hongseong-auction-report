FROM mcr.microsoft.com/playwright:v1.60.0-noble

WORKDIR /app

COPY --chown=pwuser:pwuser package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --omit=optional && npm cache clean --force

COPY --chown=pwuser:pwuser src ./src
COPY --chown=pwuser:pwuser fixtures ./fixtures
COPY --chown=pwuser:pwuser data ./data
COPY --chown=pwuser:pwuser public ./public

ENV NODE_ENV=production
ENV AUCTION_MODE=live

USER pwuser

CMD ["npm", "run", "update"]

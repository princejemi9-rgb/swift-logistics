FROM node:24-alpine
WORKDIR /app
COPY . .
RUN mkdir -p /var/lib/swift-logistics
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/var/lib/swift-logistics
EXPOSE 3000
VOLUME ["/var/lib/swift-logistics"]
CMD ["node", "server.js"]

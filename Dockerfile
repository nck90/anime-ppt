# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source code
COPY . .

# Create necessary directories and set permissions
RUN mkdir -p uploads public/thumbnails && \
    chown -R node:node /app

# Switch to non-root user
USER node

# Expose port
EXPOSE 8443

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8443/ || exit 1

# Start the application
CMD ["node", "server.js"] 
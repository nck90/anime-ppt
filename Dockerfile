# Build stage
FROM node:18-alpine as builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Production stage
FROM node:18-alpine

WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm install --only=production

# Copy built files from builder stage
COPY --from=builder /app/views ./views
COPY --from=builder /app/public ./public
COPY --from=builder /app/server.js ./

# Create necessary directories
RUN mkdir -p uploads public/thumbnails

# Expose port
EXPOSE 3000

# Start the application
CMD ["node", "server.js"] 
FROM node:18-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Create necessary directories
RUN mkdir -p uploads public/thumbnails

# Expose port
EXPOSE 8443

# Start the application
CMD ["node", "server.js"] 
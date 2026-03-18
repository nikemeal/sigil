FROM node:22-slim

WORKDIR /app

# Install dependencies first (cached layer)
COPY package.json package-lock.json ./
RUN npm ci --production

# Copy source
COPY tsconfig.json ./
COPY src/ ./src/

# Build
RUN npx tsc

# Create directories for runtime data
RUN mkdir -p data local skills

# Run as non-root
RUN useradd --system --no-create-home sigil && \
    chown -R sigil:sigil /app
USER sigil

EXPOSE 3033

CMD ["node", "dist/index.js"]

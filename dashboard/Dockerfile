# ────────────────────────────────────────────────────────────────
# Stage 1 — deps: install node modules (cached as long as lockfile is unchanged)
# ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Install OS deps required by some npm packages on Alpine
RUN apk add --no-cache libc6-compat

COPY package.json package-lock.json ./
RUN npm install --legacy-peer-deps --no-audit --no-fund

# ────────────────────────────────────────────────────────────────
# Stage 2 — builder: build the Next.js standalone output
# ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# NEXT_PUBLIC_* values are inlined into the browser bundle at BUILD time,
# so they must be supplied as build args. Server-only secrets (e.g. CLERK_SECRET_KEY)
# must NOT be passed here.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG CLERK_SECRET_KEY
ARG NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
ARG NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/overview
ARG NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/overview

ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL \
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY \
    CLERK_SECRET_KEY=$CLERK_SECRET_KEY \
    NEXT_PUBLIC_CLERK_SIGN_IN_URL=$NEXT_PUBLIC_CLERK_SIGN_IN_URL \
    NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=$NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL \
    NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=$NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL \
    NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

# ────────────────────────────────────────────────────────────────
# Stage 3 — runner: minimal production runtime (only standalone output)
# ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Run as a non-root user
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Standalone output bundles only what's needed; "static" and "public" are copied separately
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3000/ >/dev/null 2>&1 || exit 1

CMD ["node", "server.js"]

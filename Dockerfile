# Multi-stage Dockerfile for Aetherlight project
# Combines all services: web, shard, operator, and nexus

# ==============================================================================
# Builder stage - Base build environment
# ==============================================================================
FROM rust:1.85-slim AS builder

# Set environment variable to ensure non-interactive frontend for apt-get
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies required for building the project
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    pkg-config \
    cmake \
    libssl-dev \
    nodejs \
    npm \
    libsdl2-dev \
    binaryen \
    && rm -rf /var/lib/apt/lists/*

RUN rustup target add wasm32-unknown-unknown
RUN cargo install wasm-bindgen-cli

WORKDIR /workdir

# Copy the prepared workspace structure (Cargo.toml files and src stubs)
# This should be created by running scripts/prepare-docker-workspace.sh first
COPY .docker-workspace/ /workdir/

RUN cargo build --release -p aether
RUN cargo test --all --release --no-run
RUN cargo build --release --target=wasm32-unknown-unknown -p client-web

WORKDIR /workdir
COPY ./crates ./crates
COPY ./js ./js
COPY Cargo.toml Cargo.lock ./

RUN find ./crates -name "*.rs" -exec touch {} \;

# ==============================================================================
# Server binary stage - Build server executable
# ==============================================================================
FROM builder AS server-bin

WORKDIR /workdir

# Build without default features to not include unnecessary dependencies
RUN cargo build --release -p aether --no-default-features
RUN cp ./target/release/aether /workdir/aether

# ==============================================================================
# Client WASM stage - Build client WebAssembly
# ==============================================================================
FROM builder AS client

WORKDIR /workdir

RUN cargo build --target wasm32-unknown-unknown --release -p client-web
RUN wasm-bindgen --target web --out-dir ./target/web ./target/wasm32-unknown-unknown/release/client_web.wasm

# ==============================================================================
# NPM install stage - Install web dependencies
# ==============================================================================
FROM builder AS npm-install

WORKDIR /workdir

RUN mkdir -p ./web
COPY ./web/build ./web/build
COPY ./web/src ./web/src
COPY ./web/static ./web/static
COPY ./web/*.* ./web/

RUN cd /workdir/web && npm install

# ==============================================================================
# NPM build stage - Build web assets
# ==============================================================================
FROM npm-install AS npm-build

WORKDIR /workdir
COPY --from=client /workdir/target/web/* ./web/out/

COPY ./js ./js

RUN cd web && npm run build

# ==============================================================================
# Runtime base - Common runtime dependencies
# ==============================================================================
FROM debian:bookworm-slim AS runtime-base

RUN apt-get update && apt-get install -y --no-install-recommends \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

# ==============================================================================
# Web service - Server with web assets
# ==============================================================================
FROM runtime-base AS web

WORKDIR /web

COPY --from=server-bin /workdir/aether /usr/local/bin/aether
COPY --from=npm-build /workdir/web/out ./

ENTRYPOINT ["aether", "web", "/web"]

# ==============================================================================
# Shard service - Server for shard functionality
# ==============================================================================
FROM runtime-base AS shard

COPY --from=server-bin /workdir/aether /usr/local/bin/aether

ENTRYPOINT ["aether", "shard"]

# ==============================================================================
# Operator service - Kubernetes operator
# ==============================================================================
FROM runtime-base AS operator

ENV NAMESPACE=default

COPY --from=server-bin /workdir/aether /usr/local/bin/aether

ENTRYPOINT ["sh", "-c", "aether operator --namespace \"${NAMESPACE:-default}\""]

# ==============================================================================
# Nexus service - Server for nexus functionality
# ==============================================================================
FROM runtime-base AS nexus

COPY --from=server-bin /workdir/aether /usr/local/bin/aether

ENTRYPOINT ["aether", "nexus", "/shards/default"]

# ==============================================================================
# Default stage - Combined image with all binaries
# ==============================================================================
FROM runtime-base AS aether

WORKDIR /app

# Copy server binary (includes operator functionality)
COPY --from=server-bin /workdir/aether /usr/local/bin/aether

# Copy web assets to /web directory
COPY --from=npm-build /workdir/web/out /web/

# Set default environment variables
ENV NAMESPACE=default

# Default entrypoint - can be overridden
ENTRYPOINT ["aether"]

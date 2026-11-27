# Tafac (formerly l'ent) production image: the page (one build for every
# university) and its server, the Rust gateway of back/ (back/README.md),
# serving every university (MULTI_UNIVERSITY=1, as on tafac.fr). A
# self-hosted instance for one university sets MULTI_UNIVERSITY=0 and
# UNIVERSITY. See docs/SELF_HOSTING.md.
#
# Base images are pinned to exact releases (security fixes land there);
# Dependabot (.github/dependabot.yml) proposes the next ones.

# --- The page: install everything, build it ---
FROM node:24.22.2-alpine AS page
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Commit shown in "À propos" (the build context has no .git).
ARG BUILD_HASH
RUN npm run build

# --- The server: the gateway, built with tonAPI at the commit back/ pins ---
# The same Rust as tonAPI's own image and toolchain.
FROM rust:1.98.1-bookworm AS server
WORKDIR /src
# What the gateway reads of the repository as it builds (include_str!):
# the page's template, the universities' list and their mail logos.
COPY back back
COPY index.html ./
COPY universities universities
# Without `RUN --mount`: the image builds with the classic builder too.
RUN cargo build --release --locked -p tafac-gateway --manifest-path back/Cargo.toml \
    && mkdir -p /out \
    && cp back/target/release/tafac-gateway /out/

# --- Runtime: the gateway and the built page, nothing else ---
FROM debian:bookworm-slim
# native-tls: the system's OpenSSL (some CAS servers accept only cipher
# suites rustls refuses). curl for the health check.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libssl3 curl \
    && rm -rf /var/lib/apt/lists/*
# uid 1000, as the Node image's `node` user: a data volume made by an older
# image stays writable.
RUN useradd --system --uid 1000 --no-create-home --shell /usr/sbin/nologin tafac \
    && mkdir -p /app/data && chown tafac:tafac /app/data
COPY --from=server /out/tafac-gateway /usr/local/bin/tafac-gateway
COPY --from=page /app/dist /app/dist
WORKDIR /app
# DATA_DIR: automatic app icons are remembered here: mount a volume on it
# (deploy/docker-compose.yml does).
ENV MULTI_UNIVERSITY=1 \
    TAFAC_GATEWAY_LISTEN=0.0.0.0:3000 \
    TAFAC_GATEWAY_DIST=/app/dist \
    DATA_DIR=/app/data
USER tafac
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS -o /dev/null http://127.0.0.1:3000/robots.txt || exit 1
STOPSIGNAL SIGTERM
CMD ["/usr/local/bin/tafac-gateway"]

FROM rust:1.96.0-bookworm AS builder
WORKDIR /workspace

COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY proto ./proto
COPY backend ./backend
RUN cargo build --locked --release -p cc-server

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 10001 claude \
  && useradd --system --uid 10001 --gid claude --home-dir /nonexistent --shell /usr/sbin/nologin claude
COPY --from=builder /workspace/target/release/cc-server /usr/local/bin/cc-server
USER 10001:10001
EXPOSE 3000/tcp 4433/udp
ENTRYPOINT ["/usr/local/bin/cc-server"]


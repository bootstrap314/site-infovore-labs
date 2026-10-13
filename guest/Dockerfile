FROM debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl xz-utils make gcc g++ gcc-i686-linux-gnu \
    binutils-i686-linux-gnu libc6-dev-i386-cross bc bison flex \
    libssl-dev libelf-dev ncurses-bin cpio python3 && \
    rm -rf /var/lib/apt/lists/*

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git python3 && rm -rf /var/lib/apt/lists/*
COPY runner.mjs /runner.mjs
USER 10001:10001
WORKDIR /work
CMD ["sleep", "1800"]

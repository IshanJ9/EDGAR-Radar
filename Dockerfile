# syntax=docker/dockerfile:1

# One image, four services. The API and all three workers share a single
# codebase and a single dependency tree, so they are built once here and
# differentiated purely by the command each container runs (set per-service
# in docker-compose.yml). ROADMAP.md phrases this step as "Dockerfiles for
# the API and each worker"; four near-identical files would duplicate ~95% of
# their content and drift apart, so the plural is satisfied by one image with
# four entrypoints rather than four files. See PROGRESS.md for the reasoning.
#
# Deliberately NOT included here: a HEALTHCHECK. Because one image backs both
# the HTTP API and three headless workers, any healthcheck baked in at this
# level would be wrong for three of the four services. It belongs per-service
# in compose, where "is the API answering HTTP" can be asked only of the API.


# ---- base ------------------------------------------------------------------
# node:24-bookworm-slim, matching local Node 24.15. glibc rather than Alpine
# on purpose: @huggingface/transformers pulls in sharp and onnxruntime-node,
# whose musl builds are historically fragile. bcrypt alone would have been fine
# on Alpine (it ships musl prebuilds), but the ~140MB saved is not worth a
# class of "works locally, breaks in the container" native-module failures.
FROM node:24-bookworm-slim AS base
WORKDIR /app

# onnxruntime-node's postinstall downloads a ~272MB CUDA provider on Linux x64
# (not on ARM64, the production VM). Nothing here uses a GPU; skipping keeps
# x64 builds the same size and removes a download from every `npm ci`.
ENV ONNXRUNTIME_NODE_INSTALL=skip


# ---- deps ------------------------------------------------------------------
# Full install including devDependencies - typescript is needed to compile.
# Copying only the manifests first means this layer is cached and reused
# across rebuilds unless the dependencies themselves actually change.
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci


# ---- build -----------------------------------------------------------------
# Compiles TypeScript to dist/, then bakes the embedding model weights in.
FROM deps AS build
COPY tsconfig.json ./
COPY index.ts ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

# Download the ~90MB fp32 all-MiniLM-L6-v2 weights now, at build time, so the
# running container never reaches out to Hugging Face. Without this the first
# risk-factor diff in a fresh container would block on a download, every
# container recreate would re-download, and the API could not diff at all
# without outbound internet access. Runs the compiled script (not ts-node) so
# it exercises the same code path the runtime image will.
RUN node dist/scripts/warmModelCache.js

# Fail the build if the embeddings no longer match the reference similarities
# riskFactorDiff was calibrated against (see scripts/checkEmbeddings.ts). This
# runs on the architecture the image is built for, so the production VM checks
# its own ARM64 output.
RUN node dist/scripts/checkEmbeddings.js


# ---- migrator --------------------------------------------------------------
# One-off stage for running `node-pg-migrate` as its own docker-compose
# service, ahead of the API/workers starting. Deliberately extends `deps`
# (full node_modules, devDependencies included) rather than `runtime`:
# node-pg-migrate is a devDependency, and migrations are plain CommonJS files
# that need no TypeScript compilation - `runtime`'s pruned tree is the wrong
# base for this, `deps` is exactly right.
FROM deps AS migrator
COPY migrations ./migrations
CMD ["npx", "node-pg-migrate", "up"]


# ---- runtime ---------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production

# A second, production-only install: this tree has no typescript, ts-node, or
# @types/* in it. `npm ci` is used rather than `npm install` so the lockfile
# is honoured exactly - an image that resolves different versions than the
# lockfile says is not a reproducible build.
COPY package.json package-lock.json ./
#
# onnxruntime-node ships native binaries for every OS and CPU (~290MB); only
# this image's own linux/<arch> directory is ever loaded, so the rest go.
RUN npm ci --omit=dev && npm cache clean --force \
 && ORT_BIN=node_modules/onnxruntime-node/bin/napi-v6 \
 && KEEP="linux/$(node -p process.arch)" \
 && test -f "$ORT_BIN/$KEEP/onnxruntime_binding.node" \
 && find "$ORT_BIN" -mindepth 2 -maxdepth 2 -type d ! -path "$ORT_BIN/$KEEP" -exec rm -rf {} +

COPY --from=build /app/dist ./dist

# The model weights warmed above. @huggingface/transformers is a production
# dependency, so this target directory already exists in the runtime tree.
COPY --from=build /app/node_modules/@huggingface/transformers/.cache ./node_modules/@huggingface/transformers/.cache

# The 196-company universe and the migration files. Neither the API nor the
# three workers read data/ today (only poller/backfill/reconciliation do), but
# both are small, static, and needed by the migration and ingestion steps that
# compose will run against this same image.
COPY data ./data
COPY migrations ./migrations

# The one directory any service writes to. Reconciliation (containerized in
# post-Phase 7, step 2) streams SEC's ~1.4 GB bulk zip to /app/.cache and
# deletes it after each run. Created here, while still root, and handed to the
# `node` user, since everything below runs without root. No volume: the file
# never needs to outlive a run.
RUN mkdir -p /app/.cache && chown node:node /app/.cache

# Drop root. Nothing else writes to disk; the one-off buildCompanyUniverse
# script (the only other writer in the codebase) is not run from this image.
USER node

# src/server.ts defaults to PORT 3000 when the env var is unset.
EXPOSE 3000

# Default command is the API. The three workers override this in compose:
#   node dist/scripts/parserWorker.js
#   node dist/scripts/scoringWorker.js
#   node dist/scripts/notificationWorker.js
CMD ["node", "dist/src/server.js"]

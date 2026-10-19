# Run from this directory, or use make -C path/to/terminal-site <target>.
.DEFAULT_GOAL := help
.NOTPARALLEL:
.DELETE_ON_ERROR:

PROJECT_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
ifneq ($(PROJECT_DIR),$(CURDIR))
$(error Run make from $(PROJECT_DIR), or use make -C "$(PROJECT_DIR)" <target>)
endif

NODE ?= node
NPM ?= npm
GO ?= go
DOCKER ?= docker
PORT ?= 4173
TEST_URL ?= http://127.0.0.1:$(PORT)
CHROME_CHANNEL ?= chrome
export PORT TEST_URL CHROME_CHANNEL GO NPM DOCKER

.PHONY: help setup doctor deps termtex browser-install build content notes projects resume guest snapshot web \
        serve preview package archive verify-package check test test-unit test-browser test-notes test-resume \
        test-console test-smoke test-reader test-diagrams test-projects test-text-view test-offline \
        test-resume-browser test-shell test-ip bench clean clean-cache clean-all \
        check-node check-npm check-go check-docker check-dist check-preview browser-ready \
        deploy-plan deploy-staging deploy-production test-publishing test-archives

##@ Start here
help: ## Show targets, settings, and workflows without build dependencies
	@awk 'BEGIN { print "Personal / Space — run make from terminal-site/\n"; print "Usage: make [target] [SETTING=value]\nDefault: make = make help" } /^##@/ { printf "\n%s\n", substr($$0,5) } /^[a-zA-Z0-9_-]+:.*## / { split($$0,a,":"); sub(/^.*## /,"",$$0); printf "  %-22s %s\n",a[1],$$0 }' Makefile
	@printf '\nSettings (environment variables or make arguments):\n  PORT=4173                 Local preview port\n  TEST_URL=http://127.0.0.1:PORT  Site used by browser tests and benchmark\n  CHROME_CHANNEL=chrome     Use chromium after make browser-install\n  NODE=node NPM=npm GO=go DOCKER=docker  Tool executable paths\n\nExamples:\n  make setup && make doctor      Prepare and check a fresh clone\n  make preview                   Full build, then serve it\n  make web                       Refresh CSS/JS/HTML using the existing guest\n  make serve PORT=8080            Serve an existing build on another port\n  make test-smoke PORT=8080       Test that preview from another terminal\n  make package                   Full build and self-hosting archive\n\nBrowser tests need a running preview. Build after editing content or guest code.\nOutput: dist/  |  Releases: release/  |  Test reports: .test-results/\n'

setup: deps termtex ## Install locked Node dependencies and build the math formatter
	@printf '\nSetup complete. Run make doctor, then make preview.\n'

doctor: check-node ## Check Node, npm, Go, Docker/Compose, and the selected browser
	@"$(NODE)" scripts/doctor.mjs

deps: node_modules/.package-lock.json ## Install Node dependencies when package manifests change

node_modules/.package-lock.json: package.json package-lock.json | check-node check-npm
	"$(NPM)" ci
	@touch node_modules/.package-lock.json

termtex: .build/termtex ## Build the pinned host-side LaTeX-to-text formatter if needed

.build/termtex: tools/termtex/go.mod tools/termtex/go.sum | check-go
	@mkdir -p .build
	GOMODCACHE="$(CURDIR)/.build/go-mod" GOCACHE="$(CURDIR)/.build/go-cache" "$(GO)" -C tools/termtex build -mod=readonly -trimpath -o "$(CURDIR)/$@" github.com/doug/termtex/cmd/termtex

browser-install: deps ## Download Playwright Chromium; then use CHROME_CHANNEL=chromium
	"$(NODE)" node_modules/playwright/cli.js install chromium

##@ Build
build: snapshot ## Full build: content -> Linux guest -> snapshot -> static dist/
	"$(NODE)" scripts/build.mjs

content: notes projects resume ## Compile all authored content into .build/ only

notes: deps termtex ## Compile notes/**/*.md, math, and diagrams
	"$(NODE)" scripts/notes.mjs

projects: deps termtex ## Compile projects/**/*.md, math, diagrams, and screenshots
	"$(NODE)" scripts/notes.mjs projects

resume: deps ## Compile misc/resume.tex into intermediate résumé content
	"$(NODE)" scripts/resume.mjs

guest: check-docker content ## Compile Linux, BusyBox, and ncurses; rebuild the initramfs
	"$(DOCKER)" compose run --build --rm guest-builder

snapshot: guest ## Rebuild the guest and save its ready-to-use VM snapshot
	"$(NODE)" scripts/snapshot.mjs

web: deps resume ## Rebuild the browser UI/PDF using a matching guest; stale inputs fail
	"$(NODE)" scripts/build.mjs

##@ Preview and package
serve: check-node check-dist ## Serve the existing dist/ at http://127.0.0.1:PORT; Ctrl+C stops it
	"$(NODE)" scripts/serve.mjs

preview: build serve ## Full build followed by the local preview server

package: build archive verify-package ## Full build, create the static archive, and verify its checksum

archive: check-node check-dist ## Package the existing dist/ without rebuilding it
	"$(NODE)" scripts/package.mjs

verify-package: check-node ## Verify release/site-static.tar.gz against its SHA-256 checksum
	"$(NODE)" scripts/verify-package.mjs

##@ Cloudflare publishing (see deploy/cloudflare/README.md)
deploy-plan: check-node check-dist ## Show R2 files, upload order, and headers without credentials or writes
	@"$(NODE)" scripts/publish.mjs staging --dry-run
	@"$(NODE)" scripts/publish.mjs production --dry-run

deploy-staging: check-node check-dist ## Publish existing dist/ to the Access-protected staging bucket
	"$(NODE)" scripts/publish.mjs staging

deploy-production: check-node check-dist ## Publish existing dist/ to both public domains
	"$(NODE)" scripts/publish.mjs production

##@ Verify (browser targets need make serve in another terminal)
check: test-unit test-archives test-console ## Run compiler, archive-integrity, and real-guest checks

test: check test-browser ## Run all compiler, guest, and browser checks

test-unit: test-notes test-resume test-publishing ## Run compiler/publishing tests; no Docker or browser required

test-notes: deps termtex ## Check Markdown, diagrams, screenshots, and math compilation
	"$(NODE)" --test tests/notes.test.mjs

test-resume: deps ## Check résumé extraction and contact filtering
	"$(NODE)" --test tests/resume.test.mjs

test-publishing: check-node ## Test R2 upload ordering, metadata, and staging protection checks
	"$(NODE)" --test tests/publishing.test.mjs

test-archives: check-docker ## Check archive rejection, extraction recovery, and cache reuse in Docker
	"$(DOCKER)" compose run --build --rm -T --no-deps guest-builder python3 tests/archives.py

test-console: deps ## Test the existing guest's serial console with snapshot and cold boots
	"$(NODE)" tests/console.mjs

test-browser: test-smoke test-reader test-diagrams test-projects test-text-view test-offline test-resume-browser test-shell test-ip ## Run every browser suite against the existing build

test-smoke: browser-ready ## Check startup, navigation, fallback, and responsive layout
	"$(NODE)" tests/smoke.mjs

test-reader: browser-ready ## Check Notes navigation, math, images, and themes
	"$(NODE)" tests/notes-browser.mjs

test-diagrams: browser-ready ## Check ASCII/SVG defaults, independent toggles, and offline diagrams
	"$(NODE)" tests/diagrams-browser.mjs

test-projects: browser-ready ## Check Projects, screenshots, repository links, and shell reading
	"$(NODE)" tests/projects-browser.mjs

test-text-view: browser-ready ## Check scoped Read as text content and resizing
	"$(NODE)" tests/text-view-browser.mjs

test-offline: deps check-dist ## Test offline caching and atomic updates using an isolated local server
	"$(NODE)" tests/offline-browser.mjs

test-resume-browser: browser-ready ## Check résumé layout, PDF, and terminal-session preservation
	"$(NODE)" tests/resume-browser.mjs

test-shell: browser-ready ## Check real BusyBox history, completion, piping, and the note pager
	"$(NODE)" tests/shell-browser.mjs

test-ip: browser-ready ## Check ip a with mocked lookup responses; no real IP lookup
	"$(NODE)" tests/ip-browser.mjs

bench: browser-ready ## Measure snapshot, cached, cold-boot, and throttled startup
	"$(NODE)" tests/benchmark.mjs

##@ Cleanup (authored content and local public/vm/ outputs are kept)
clean: ## Remove dist/, release/, and .test-results/; keep dependencies and caches
	rm -rf dist release .test-results

clean-cache: ## Remove .build/ (generated content, termtex, Go caches, diagram/PDF caches)
	rm -rf .build

clean-all: clean clean-cache ## Also remove node_modules/; Docker's compiler cache is kept
	rm -rf node_modules

# Private preflight targets provide short, actionable errors before long jobs.
check-node:
	@command -v "$(NODE)" >/dev/null 2>&1 || { printf 'Node.js is missing. Install Node 24+ or set NODE=/path/to/node.\n' >&2; exit 1; }
	@"$(NODE)" -e 'if (+process.versions.node.split(".")[0] < 24 || typeof require("node:zlib").zstdCompressSync !== "function") { console.error("Node 24+ with zstd support is required. Current: " + process.version); process.exit(1); }'

check-npm:
	@command -v "$(NPM)" >/dev/null 2>&1 || { printf 'npm is missing. Install npm or set NPM=/path/to/npm.\n' >&2; exit 1; }

check-go:
	@command -v "$(GO)" >/dev/null 2>&1 || { printf 'Go is missing. Install Go 1.22+ to build termtex, or set GO=/path/to/go.\n' >&2; exit 1; }

check-docker:
	@command -v "$(DOCKER)" >/dev/null 2>&1 || { printf 'Docker is missing. Install Docker with Compose or set DOCKER=/path/to/docker.\n' >&2; exit 1; }
	@"$(DOCKER)" info >/dev/null 2>&1 || { printf 'Docker is not running. Start Docker Desktop/OrbStack (or your Docker daemon), then retry.\n' >&2; exit 1; }
	@"$(DOCKER)" compose version >/dev/null 2>&1 || { printf 'Docker Compose is missing. Install the Docker Compose plugin, then retry.\n' >&2; exit 1; }

check-dist:
	@test -f dist/index.html -a -f dist/manifest.json || { printf 'No complete dist/ found. Run make build first, or make preview to build and serve.\n' >&2; exit 1; }

check-preview: check-node
	@"$(NODE)" scripts/check-preview.mjs

browser-ready: deps check-preview
	@mkdir -p .test-results

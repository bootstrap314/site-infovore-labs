# Cloudflare R2 publishing

This setup serves the compiled site directly from two R2 buckets through Cloudflare's CDN. There are no Workers, Pages Functions, server processes, or AWS resources. AWS CLI is just the client for R2's S3-compatible API. The browser still runs its own v86 Web Worker.

| Environment | R2 bucket | Hostnames | Access |
| --- | --- | --- | --- |
| Staging | `infovore-labs-staging` | `staging.infovore-labs.com` | Your Cloudflare login, restricted to your email |
| Production | `infovore-labs-production` | `www.infovore-labs.com`, `infovore-labs.com` | Public |

Both public hostnames serve the site directly. Their browser storage is separate. Hostnames and bucket names are declared in [config.json](config.json). Staging's hostname also appears in `src/offline.js`, which disables its offline cache.

## One-time Cloudflare setup

1. Add `infovore-labs.com` as an active zone in the same Cloudflare account that owns R2. Create the two empty buckets above in the default jurisdiction. Keep **Public Development URL (`r2.dev`) disabled** on both. Do not attach any additional custom domains to the staging bucket. [R2 custom domains and public access](https://developers.cloudflare.com/r2/buckets/public-buckets/)
2. Set up a Zero Trust organization if needed. Under **Integrations → Identity providers**, select or add **Cloudflare**, and enable **Restrict to account members**. This uses your existing Cloudflare credentials and account security. [Cloudflare identity provider](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/cloudflare/)
3. Create an Access **Self-hosted** application for the entire `staging.infovore-labs.com` hostname. Leave the path empty. Select only the Cloudflare identity provider. Use a session duration such as one hour. Add a single **Allow** policy whose **Include → Emails** value is your Cloudflare login email. Do not add Everyone, Bypass, Service Auth, alternative identity providers, WARP authentication, or a more-specific application that bypasses this policy. Account membership alone would also allow other members; the email rule narrows access to you.
4. After that Access application exists, attach `staging.infovore-labs.com` to the staging bucket. Attach both production hostnames to the production bucket. Use the bucket's **Custom Domains → Connect Domain** flow so Cloudflare creates the appropriate DNS records. Wait for the domains and certificates to become active. Set minimum TLS to 1.2 or higher. [Protect R2 with Access](https://developers.cloudflare.com/r2/tutorials/cloudflare-access/)
5. Enable HTTPS redirects for the three hostnames. Add the rewrite and caching rules below before the first publish. Ensure no later rule overrides these hosts' caching or access behavior.

The publisher reads the bucket settings before each deployment. It refuses enabled `r2.dev` access or unexpected active domains. For staging, it also checks the Access application, identity provider, email policy, and unauthenticated responses for the root, entry page, service worker, and an asset. These checks do not provision resources or modify your Access policies.

## Static routing, caching, and compression

R2 maps paths to object keys and does not use the site's `_headers` file. Add the following zone rules through the dashboard. [rules.json](rules.json) contains their exact API-shaped definitions, grouped by phase; it is a reference, not a command to replace your existing zone rulesets.

- **URL Rewrite Rule:** for the three site hostnames when the path equals `/`, statically rewrite the path to `/index.html`. Leave the query unchanged. This is an internal rewrite, so `/#shell` and `/?cold` remain normal entry URLs. There is no catch-all SPA rewrite; other missing objects remain 404s. See [URL Rewrite Rules](https://developers.cloudflare.com/rules/transform/url-rewrite/).
- **Cache Rule 1:** bypass cache for all requests to the three hostnames. This keeps HTML, the service worker, manifest, PDF, and other fixed URLs current.
- **Cache Rule 2 (after rule 1):** for the two public hostnames only, make `/assets/`, `/notes-assets/`, and `/projects-assets/` eligible for cache. Respect origin cache headers for both edge and browser TTL. These directories use content-addressed filenames; the publisher sets `public, max-age=31536000, immutable`. See [R2 and the CDN cache](https://developers.cloudflare.com/cache/interaction-cloudflare-products/r2/).
- **Response Header Transform Rule:** on staging, set `Cache-Control: private, no-store` and `X-Robots-Tag: noindex, nofollow, noarchive`. Staging objects also receive `private, no-store` as R2 metadata. Staging never registers the offline service worker and removes any previous site cache on load.

Use Cloudflare's standard response compression; where configuring Compression Rules explicitly, enable Brotli with gzip fallback for supported content types. The uploader sends original bytes and skips `.br`/`.gz` HTTP sidecars, because R2 does not negotiate sidecar filenames. It retains the actual `initramfs.cpio.gz` resource. WASM receives `application/wasm`; the `.zst` snapshot receives `application/octet-stream` with **no Content-Encoding**. v86 decodes that snapshot itself. Files already downloaded into an open browser cannot be revoked by an Access logout; staging's next network visit requires authentication again.

Disable automatic response-body rewriting for these hosts, including Rocket Loader, Email Address Obfuscation, and HTML/JavaScript minification. The offline inventory and post-publish checks verify the original response bytes. HTTP compression is fine because browsers decode it before integrity checks.

## GitHub configuration

These files belong at the root of the `terminal-site` Git repository, which is [bootstrap314/site-infovore-labs](https://github.com/bootstrap314/site-infovore-labs). They are not workflows in the parent workspace directory.

Create GitHub environments named **staging** and **production** under Settings → Environments. Restrict deployment branches to **main** for both. For production, enable a required reviewer if you want a second approval after manually starting a promotion. Protect `main` and require the **Build and test** check before merging.

Set these **environment variables** in both environments:

| Variable | Value |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | The 32-character account ID owning R2 and Access |
| `CLOUDFLARE_ZONE_ID` | The 32-character ID for the `infovore-labs.com` zone |

Add these variables only to **staging**:

| Variable | Value |
| --- | --- |
| `CLOUDFLARE_ACCESS_APP_ID` | The Access application's UUID |
| `STAGING_ACCESS_EMAIL` | The exact email in the application's Allow policy |

Set these **secrets** separately in each environment:

| Secret | Permission/scope |
| --- | --- |
| `R2_ACCESS_KEY_ID` | Access key from an R2 Object Read & Write token limited to that environment's bucket |
| `R2_SECRET_ACCESS_KEY` | Matching R2 secret key |
| `CLOUDFLARE_API_TOKEN` | Account **Workers R2 Storage: Read** and zone **Cache Purge: Purge**; staging additionally needs **Access: Apps and Policies: Read** and **Access: Organizations, Identity Providers, and Groups: Read** |

Scope the Cloudflare token to this account and zone; it does not need DNS or ruleset write permissions. The R2 S3 credentials and the Cloudflare management API token are different credentials. GitHub maps the R2 secrets to the AWS-compatible environment variable names only during the upload step. No deployment credentials are provided to the build or PR jobs.

## Normal publishing workflow

1. Open a PR. **Site** builds Linux, content, and the browser bundle, runs the full test suite, and saves a `static-site` artifact. It never deploys a PR or runs it with Cloudflare credentials.
2. Merge to `main`. The same workflow builds and tests again, then uploads that run's artifact to staging. Open the staging hostname and sign in with Cloudflare. A missing configuration or failed Access check fails the deployment before uploading files.
3. Copy the numeric run ID from the successful Site run's URL: `.../actions/runs/123456789`.
4. Run **Publish production** from the Actions tab on `main`, supplying that run ID. It verifies the run came from this repository's `main` push and successfully published staging, downloads the same artifact, and uploads it to the production bucket. There is no production rebuild.
5. Both public hostnames are checked against the uploaded root page and service worker bytes. The run summary records the source commit and staging run ID.

The workflows use pinned GitHub Action commits, read-only repository permissions, and environment-specific secrets. Dependabot checks action updates monthly. Ubuntu runners include AWS CLI v2; a local deploy requires installing it yourself. See [R2's AWS CLI instructions](https://developers.cloudflare.com/r2/examples/aws/aws-cli/).

## Local commands

Run from `terminal-site/`:

```sh
make                       # Help; does not build or deploy
make build                 # Rebuild the complete site
make deploy-plan           # Print both upload plans; no credentials or network needed
make test-publishing       # Test the publisher and promotion checks locally
```

For an intentional local publish, copy `.env.example` to the repository's `.env.cloudflare`, fill in credentials for the intended bucket, and export them:

```sh
cp deploy/cloudflare/.env.example .env.cloudflare
# Edit .env.cloudflare, then:
set -a
. ./.env.cloudflare
set +a
make deploy-staging
# Use production-scoped credentials before make deploy-production.
```

Never commit `.env.cloudflare`. `make deploy-*` publishes the existing `dist/` and validates its file inventory and integrity; it does not implicitly rebuild. Prefer the production workflow when promoting a reviewed staging artifact.

## Updates, failure recovery, and rollback

The uploader sends immutable assets first, other documents second, entry pages third, and `sw.js` last. It stops if a phase fails, retains older hashed assets for existing tabs, and purges only fixed URLs. It never syncs with `--delete` or purges the whole zone.

R2 object writes are individual operations, not an atomic directory swap. During the short upload window a request can see mixed fixed documents. Production's service worker validates the complete build inventory and retains the last working cache if installation fails. Retry the **same artifact** after an upload or post-publish check fails. A partial entry-page phase may have updated one page before a later failure; retrying completes it.

To roll back production, rerun **Publish production** with an earlier successful staging run ID. Artifacts are retained for 30 days. Keep an external copy of an important release if it must remain available longer; otherwise rebuild and stage the desired source revision. Old hashed R2 assets are intentionally retained and will accumulate; do not add a blanket bucket lifecycle deletion rule that could remove currently referenced assets.

The code and workflows can be tested locally without Cloudflare credentials. The live Access, DNS, cache, and upload checks run only after the one-time account setup and GitHub secrets are supplied.

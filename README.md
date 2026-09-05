# auth.net.im

`auth.net.im` is a lightweight Cloudflare Worker authentication gateway and reusable authentication package built around Hono and composable authentication providers.

The Hono host owns HTTP routing and response normalization. Providers own verification and provider-specific authorization policy. The first provider is GitHub Actions OIDC.

```text
qualification / deployment owner
        ↓
Cloudflare Worker
    runtime host
        ↓
Hono
    provider-neutral HTTP routing
        ↓
AuthProvider contract
        ↓
composed auth providers
    github
    future providers
```

## Reusable package surface

The repository is an importable package named `@xd-dash/auth.net.im`.

```text
@xd-dash/auth.net.im/core
    AuthProvider
    AuthIdentity
    AuthInput
    AuthError

@xd-dash/auth.net.im/providers/github
    GitHubProvider
    GitHubEnv
    GitHubClaims
    GitHubProvider.middleware()
```

Provider implementations are namespaced under `providers`. Consumers get one public composition surface per provider and do not need to know where framework adapters live internally.

A Hono Worker can use the GitHub provider directly:

```ts
import { Hono } from "hono"
import {
  GitHubProvider,
  type GitHubAuthEnv,
} from "@xd-dash/auth.net.im/providers/github"

const app = new Hono<GitHubAuthEnv>()

app.use("/protected/*", GitHubProvider.middleware())
app.get("/protected/me", c => c.json(c.get("authIdentity")))

export default app
```

The lower-level provider remains independently usable:

```ts
import {
  GitHubProvider,
  type GitHubEnv,
} from "@xd-dash/auth.net.im/providers/github"

const provider = new GitHubProvider()
const identity = await provider.authenticate({ request, env })
```

`GitHubProvider` consumes the provider-neutral `Request + env` contract. Its `middleware()` static method is a thin Hono adapter over the same provider behavior.

For a Git dependency, a consuming project can pin an exact repository ref:

```json
{
  "dependencies": {
    "@xd-dash/auth.net.im": "github:xd-dash/auth.net.im#<commit-or-tag>"
  }
}
```

The package remains `private` to prevent accidental npm publication; Git-based composition still uses the declared package name and `exports` map.

## REST application

Canonical API:

```text
POST /v1/auth/:provider
Authorization: Bearer <provider assertion>
```

Authentication/error responses are `Cache-Control: no-store`. `401` responses include a Bearer `WWW-Authenticate` challenge.

## GitHub Actions OIDC

The GitHub provider uses Hono's JWT/JWKS verification helpers. Verification is restricted to `RS256`, requires GitHub's issuer and the configured audience, applies Hono's `exp`/`nbf`/`iat` checks, and then applies local repository/ref/workflow policy.

The provider reads configuration through `GitHubEnv`; this repository deliberately does not contain deployment policy values. The deployment owner supplies them at runtime.

Required bindings:

```text
GITHUB_AUDIENCE
GITHUB_OWNER
GITHUB_REPOSITORIES
```

Optional policy restrictions:

```text
GITHUB_OWNER_ID
GITHUB_REPOSITORY_IDS
GITHUB_REFS
GITHUB_WORKFLOW_PREFIX
```

A synthetic configuration looks like:

```text
GITHUB_AUDIENCE=https://service.example
GITHUB_OWNER=example-org
GITHUB_REPOSITORIES=example-org/example-repo
GITHUB_OWNER_ID=<immutable owner id>
GITHUB_REPOSITORY_IDS=<comma-separated immutable repository ids>
GITHUB_REFS=refs/heads/main,refs/heads/release
GITHUB_WORKFLOW_PREFIX=example-org/example-repo/.github/workflows/
```

When stable IDs are configured, both the human-readable owner/repository names and the immutable IDs must match. This protects long-lived policy from repository rename/recreation ambiguity while keeping names available for diagnostics.

GitHub workflow permissions:

```yaml
permissions:
  contents: read
  id-token: write
```

A workload can request a token for its deployment-configured audience and send it to the configured authentication endpoint:

```sh
response="$(
  curl -fsS \
    -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
    "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=${GITHUB_AUDIENCE}"
)"

jwt="$(jq -r .value <<<"$response")"

curl -fsS \
  -X POST \
  -H "Authorization: Bearer $jwt" \
  "${AUTH_ENDPOINT}/v1/auth/github"
```

## Policy ownership

Reusable provider code defines the shape and semantics of policy; deployment infrastructure owns concrete policy values. Do not put a particular organization, repository, ref, workflow path, immutable ID, or audience into `wrangler.jsonc`, provider source, or package tests.

A deployment/qualification system should inject the exact bindings when starting or deploying the Worker and should own live issuer verification for its real workload identity. Package tests remain synthetic and deterministic.

## Concurrency and replay model

Providers are stateless after construction. The Hono middleware keeps no request-shared mutable authentication state; normalized identity is stored only on the current Hono context. This avoids isolate-local races between concurrent requests.

GitHub OIDC assertions are bearer credentials and can be replayed until they expire. `auth.net.im` validates assertions; it does not maintain a `jti` replay ledger. A downstream capability-exchange endpoint that requires one-time semantics should add an explicit durable replay store rather than hiding mutable replay state inside the provider.

## Composition rule

Provider-specific code belongs under `src/providers/<provider>/` and is publicly addressed as `@xd-dash/auth.net.im/providers/<provider>`. Framework adapter files may remain internal implementation details.

```text
provider primitive
    ↓
optional framework adapter
    ↓
providers/<provider> public surface
    ↓
application composition
```

Do not make downstream consumers understand internal framework-adapter directory layout merely to compose one provider.

Cloudflare is the runtime/deployment provider here, not the authentication authority. Hono is the HTTP primitive. GitHub is the identity provider. Concrete deployment policy belongs outside this package.

## Local qualification

```sh
npm ci
npm test
npm run check
npm run dev
```

`npm run check` runs TypeScript validation plus Wrangler's deploy dry-run path. Live OIDC qualification belongs to the deployment owner, where real environment policy and a real issuer token can be composed with an exact package revision.

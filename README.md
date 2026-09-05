# auth.net.im

`auth.net.im` is a lightweight Cloudflare Worker authentication gateway and reusable authentication package built around Hono and composable authentication providers.

The Hono host owns HTTP routing and response normalization. Providers own verification and provider-specific authorization policy. The first provider is GitHub Actions OIDC.

```text
Huram ABI
    exact qualification / deployment authority
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
    future google
    future cloudflare-access
    ...
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

Required Worker vars:

```text
GITHUB_AUDIENCE=auth.net.im
GITHUB_OWNER=xd-dash
GITHUB_REPOSITORIES=xd-dash/huram-abi-master
```

Optional policy restrictions:

```text
GITHUB_OWNER_ID=<immutable GitHub owner id>
GITHUB_REPOSITORY_IDS=<comma-separated immutable repository ids>
GITHUB_REFS=refs/heads/automation,refs/heads/worktree-automation
GITHUB_WORKFLOW_PREFIX=xd-dash/huram-abi-master/.github/workflows/
```

When stable IDs are configured, both the human-readable owner/repository names and the immutable IDs must match. This protects long-lived policy from repository rename/recreation ambiguity while keeping names available for diagnostics.

GitHub workflow permissions:

```yaml
permissions:
  contents: read
  id-token: write
```

Request a token for the configured audience and call the provider:

```sh
response="$(
  curl -fsS \
    -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
    "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=auth.net.im"
)"

jwt="$(jq -r .value <<<"$response")"

curl -fsS \
  -X POST \
  -H "Authorization: Bearer $jwt" \
  https://auth.net.im/v1/auth/github
```

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

Cloudflare is the runtime/deployment provider here, not the authentication authority. Hono is the HTTP primitive. GitHub is the identity provider. Huram remains exact qualification and infrastructure authority.

## Local qualification

```sh
npm install
npm test
npm run check
npm run dev
```

`npm run check` runs TypeScript validation plus Wrangler's deploy dry-run path.

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
    middleware.auth()
```

Provider implementations are namespaced under `providers`. Consumers still get one public composition surface per provider and do not need to know where framework adapters live internally.

A Hono Worker can use the GitHub provider surface:

```ts
import { Hono } from "hono"
import {
  middleware as github,
  type GitHubAuthEnv,
} from "@xd-dash/auth.net.im/providers/github"

const app = new Hono<GitHubAuthEnv>()

app.use("/protected/*", github.auth())
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

`GitHubProvider` consumes the provider-neutral `Request + env` contract and does not depend on Hono `Context`. `middleware.auth()` is only a Hono adapter over that primitive.

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

The canonical `auth.net.im` Worker consumes the same provider implementation and middleware composition used by downstream Workers.

## GitHub Actions OIDC

The GitHub provider uses Hono's `hono/jwt` helper for JWT decoding and JWKS verification. Verification is restricted to `RS256`, requires GitHub's issuer and the configured audience, applies Hono's time-claim checks, and then applies local repository/ref/workflow policy.

Required Worker vars:

```text
GITHUB_AUDIENCE=auth.net.im
GITHUB_OWNER=xd-dash
GITHUB_REPOSITORIES=xd-dash/huram-abi-master
GITHUB_REFS=refs/heads/automation,refs/heads/worktree-automation
GITHUB_WORKFLOW_PREFIX=xd-dash/huram-abi-master/.github/workflows/
```

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

## Composition rule

Provider-specific code belongs under `src/providers/<provider>/` and is publicly addressed as `@xd-dash/auth.net.im/providers/<provider>`. A provider exports the shared `AuthProvider` contract and its framework conveniences through that provider surface. Framework adapter files may remain internal implementation details.

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

`npm run check` runs TypeScript validation plus Wrangler's deploy dry-run path, matching the local Cloudflare Worker qualification boundary used by Huram.

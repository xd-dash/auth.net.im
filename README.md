# auth.net.im

`auth.net.im` is a lightweight Cloudflare Worker authentication gateway built around Hono and composable authentication providers.

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

Cloudflare is the runtime/deployment provider here, not the authentication authority. GitHub is currently the identity provider. When Cloudflare-specific operations are exposed through Smoke, they should likewise live in a modular Cloudflare provider rather than becoming Smoke-core branches.

Canonical API:

```text
POST /v1/auth/:provider
Authorization: Bearer <provider assertion>
```

The provider-neutral contract is defined in `src/auth/types.ts`. Provider composition is explicit in `src/providers/index.ts`. Architectural and maintenance invariants are recorded in `AUTH_IDIOMS.md`.

## GitHub Actions OIDC

The GitHub provider uses Hono's `hono/jwt` helper for JWT decoding and JWKS verification. Verification is restricted to `RS256`, requires GitHub's issuer and the configured audience, applies Hono's `exp`/`nbf`/`iat` checks, and then applies local repository/ref/workflow policy.

The provider deliberately uses Hono's JWKS verifier rather than hand-maintaining RSA/JWK verification. The provider contract remains ours; JWT mechanics are delegated to Hono.

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

Successful responses use the same provider-neutral identity envelope regardless of provider:

```json
{
  "authenticated": true,
  "identity": {
    "provider": "github",
    "subject": "repo:xd-dash/huram-abi-master:ref:refs/heads/automation",
    "attributes": {
      "repository": "xd-dash/huram-abi-master",
      "repository_owner": "xd-dash",
      "ref": "refs/heads/automation",
      "workflow_ref": "xd-dash/huram-abi-master/.github/workflows/example.yml@refs/heads/automation",
      "run_id": "123456789",
      "actor": "dash-xd"
    }
  }
}
```

## Composition rule

Provider-specific code belongs under `src/providers/<provider>/`. A provider exports the shared `AuthProvider` contract and is registered in `src/providers/index.ts`. Do not add provider-specific branching to the Hono host.

Hono is a primitive of the HTTP host, not an auth provider. JWT is a helper used by providers that need JWT semantics. A future provider that does not use JWT should not be forced through JWT middleware.

The same general rule applies when Smoke gains Cloudflare functionality:

```text
Smoke core
    composition + stable provider contracts

provider/cloudflare
    Cloudflare API / Wrangler behavior

Huram
    exact smoke qualification + infrastructure authority
```

The fact that Smoke grew out of Huram smoke tests should not turn Huram or Cloudflare into hidden special cases inside Smoke.

## Local qualification

```sh
npm install
npm test
npm run check
npm run dev
```

`npm run check` runs TypeScript validation plus Wrangler's deploy dry-run path, matching the local Cloudflare Worker qualification boundary already used by Huram.

# auth.net.im idioms

This file is the maintenance contract for `xd-dash/auth.net.im`. `README.md` is the user-facing guide; this file records the architectural invariants future changes should preserve unless a new requirement genuinely needs a different primitive.

## Roles

```text
Huram ABI
  qualifies, smoke-tests, promotes, and deploys exact infrastructure/runtime candidates

Cloudflare Worker
  hosts this HTTP runtime

Hono
  owns HTTP routing/middleware composition

Auth provider
  verifies one external assertion format and applies local policy

External issuer
  owns the assertion and signing keys
```

Cloudflare is runtime/deployment, Hono is an HTTP primitive, and GitHub is currently the first authentication provider.

## Provider contract

All providers implement the shared contract in `src/auth/types.ts`:

```text
AuthProvider
    name
    authenticate(AuthInput)
        -> AuthIdentity
```

`AuthIdentity` remains provider-neutral:

```text
provider
subject
attributes[string]string
```

Provider-specific claims must be normalized into that envelope. The Hono host must not understand GitHub-specific claims.

## Public package contract

The reusable package is:

```text
@xd-dash/auth.net.im
```

Supported public subpaths are:

```text
@xd-dash/auth.net.im/core
    provider-neutral primitives

@xd-dash/auth.net.im/github
    GitHubProvider
    GitHubEnv
    GitHubClaims
    middleware.auth()
```

Do not expose framework directory layout as a second public provider surface merely because an adapter is implemented there. The conceptual public unit is the provider.

Keep dependency direction:

```text
core
  ↑
github provider primitive
  ↑
internal Hono adapter
  ↑
@xd-dash/auth.net.im/github public composition surface
  ↑
application composition
```

The provider primitive must not accept or require a Hono `Context`. It consumes standard Web `Request` plus environment through `AuthInput`. Framework adapters may depend on provider primitives, never the reverse.

The Hono adapter stores normalized identity as `authIdentity` and calls `next()`. It does not redefine verification or authorization policy. It accepts `AuthProvider<GitHubEnv>` so callers can inject wrapped/deterministic providers.

The canonical `auth.net.im` Worker should consume `middleware.auth()` from the same GitHub public composition surface used by downstream Workers.

Source-level exports are intentional for the Wrangler/Git composition model. `private: true` prevents accidental npm publication; it does not make Git-composed subpath imports private.

## Composition

Provider implementations live under:

```text
src/providers/<provider>/
```

Framework adapters may live under internal paths such as:

```text
src/<framework>/<provider>/
```

but their useful provider-specific capabilities should be surfaced through the provider's public subpath when that produces a simpler composition contract.

This mirrors Smoke: optional behavior is selected compositionally while runtime dispatch uses small stable contracts.

## HTTP contract

Canonical authentication route:

```text
POST /v1/auth/:provider
Authorization: Bearer <provider assertion>
```

Providers throw typed `AuthError` values and do not construct the host's HTTP response envelope.

## JWT primitive

Providers consuming JWT assertions should prefer Hono's `hono/jwt` helpers over hand-rolled JWT verification. Do not force non-JWT providers through JWT abstractions.

For externally signed JWTs, explicitly constrain allowed algorithms. Never derive acceptable algorithms solely from an unverified JWT header.

## GitHub provider

GitHub Actions OIDC is assertion verification, not token exchange.

Preserve this flow:

```text
Bearer assertion
    ↓
Hono decode
    ↓
require RS256 + kid
    ↓
Hono verifyWithJwks
    allowedAlgorithms = RS256 only
    iss = https://token.actions.githubusercontent.com
    aud = configured audience
    exp / nbf / iat validation
    ↓
local owner/repository/ref/workflow policy
    ↓
provider-neutral AuthIdentity
```

Current configuration surface:

```text
GITHUB_AUDIENCE
GITHUB_OWNER
GITHUB_REPOSITORIES
GITHUB_REFS
GITHUB_WORKFLOW_PREFIX
```

Never use identity claims as authorization authority until signature/issuer/audience/time verification succeeds.

## Huram relationship

Huram remains qualification and infrastructure control plane. Qualification should cover:

```text
provider tests
public package import tests
TypeScript check
Wrangler deploy --dry-run
Wrangler dev --local when black-box HTTP behavior changes
```

A Huram smoke workflow may consume this repository at an exact commit SHA. That proves deployability/behavior; it does not become the runtime implementation.

## Cloudflare provider rule

When Cloudflare functionality is exposed through Smoke, prefer a modular Cloudflare provider rather than adding Cloudflare branches to Smoke core.

```text
Smoke core
    stable composition/contracts

provider/cloudflare
    Cloudflare API/Wrangler behavior

Huram
    exact infrastructure authority and qualification evidence
```

## Security invariants

- Provider assertions are bearer credentials; never log them.
- Authentication responses use `Cache-Control: no-store`.
- Unknown providers and provider configuration errors fail closed.
- JWT algorithms are explicitly allowlisted for asymmetric verification.
- Authorization is local policy over a cryptographically verified external identity.
- DNS, routing, runtime hosting, and identity authority are separate roles.

## Change protocol

For provider/package changes:

```text
1. update provider primitive
2. keep framework concerns in thin adapters
3. surface provider conveniences through the provider public subpath
4. avoid exposing internal adapter directory layout unless independently useful
5. add/update contract tests using declared package imports
6. keep provider primitive framework-neutral
7. run npm test
8. run TypeScript check
9. run Wrangler deploy --dry-run
10. update README for user-visible changes
11. update this file for architectural changes
```

Prefer the least-powerful new primitive. If a feature fits as another provider capability or thin adapter, do that instead of expanding the host.

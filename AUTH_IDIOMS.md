# auth.net.im idioms

This file is the maintenance contract for `xd-dash/auth.net.im`. `README.md` is the user-facing guide; this file records the architectural invariants that future changes should preserve unless a new requirement genuinely needs a different primitive.

## Roles

```text
Huram ABI
  qualifies, smoke-tests, promotes, and deploys exact infrastructure/runtime candidates

Cloudflare Worker
  hosts this HTTP runtime

Hono
  owns HTTP routing/middleware composition

Auth host
  owns provider-neutral response normalization

Auth provider
  verifies one external assertion format and applies its local policy

External issuer
  owns the actual identity assertion and signing keys
```

Cloudflare is therefore a runtime/deployment provider here, not an authentication authority. Hono is an HTTP primitive of this Worker. GitHub is currently the first authentication provider.

## Provider contract

All authentication providers implement the shared TypeScript contract in `src/auth/types.ts`:

```text
AuthProvider
    name
    authenticate(AuthInput)
        -> AuthIdentity
```

`AuthIdentity` is deliberately provider-neutral:

```text
provider
subject
attributes[string]string
```

Provider-specific claims must be normalized into that envelope. Do not make the Hono host understand GitHub-specific claims, Google-specific claims, Cloudflare Access claims, etc.

## Composition

Providers live under:

```text
src/providers/<provider>/
```

and are composed explicitly in:

```text
src/providers/index.ts
```

The registry is the composition boundary. Adding a provider means importing/registering its implementation there. Avoid dynamic module loading, remote code loading, or provider discovery inside request handling unless a future requirement proves static composition insufficient.

This mirrors the Smoke rule: optional behavior is selected at composition time; runtime dispatch uses a small stable contract.

Hono belongs below that composition boundary. It handles routing and middleware ergonomics; it is not itself the provider registry or identity contract.

## HTTP contract

Canonical authentication route:

```text
POST /v1/auth/:provider
Authorization: Bearer <provider assertion>
```

Success:

```json
{
  "authenticated": true,
  "identity": {
    "provider": "...",
    "subject": "...",
    "attributes": {}
  }
}
```

Failure:

```json
{
  "authenticated": false,
  "error": {
    "code": "...",
    "message": "..."
  }
}
```

The host owns this wire shape. Providers throw typed `AuthError` values and do not construct HTTP responses.

## JWT primitive

Providers that consume JWT assertions should prefer Hono's `hono/jwt` helper over hand-rolled JWT parsing/signature verification.

Use only the JWT pieces the provider needs:

```text
decode
verify
verifyWithJwks
jwt middleware
```

Do not force non-JWT providers through JWT abstractions.

For externally signed JWTs, explicitly constrain allowed algorithms. Never derive acceptable algorithms solely from an unverified JWT header. Pin Hono to a version containing the current JWK/JWT security fixes and keep that version covered by exact CI qualification.

## GitHub provider

GitHub Actions OIDC is assertion verification, not token exchange.

The provider uses Hono's JWT helper and must preserve this flow:

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

Authorization policy belongs in Worker configuration, not in JWT parsing logic.

Current configuration surface:

```text
GITHUB_AUDIENCE
GITHUB_OWNER
GITHUB_REPOSITORIES
GITHUB_REFS
GITHUB_WORKFLOW_PREFIX
```

Comma-separated lists are exact allowlists. Empty optional restrictions mean that dimension is not restricted. Required configuration must fail closed.

Never use `repository`, `ref`, `workflow_ref`, or other identity claims as authorization authority until Hono has completed signature/issuer/audience/time verification.

## Key handling

GitHub signing keys are public material and are resolved through GitHub's JWKS endpoint by Hono's `verifyWithJwks` helper. Tests may inject exact JWKs into the provider constructor to keep signature verification deterministic without changing the production contract.

Private application credentials do not belong in this provider unless a later token-issuing capability explicitly needs them. If application secrets are added, use Worker secrets/bindings, never checked-in vars.

## Huram relationship

Huram remains the qualification and infrastructure control plane. `auth.net.im` should be locally qualified with the same Wrangler boundary Huram uses for Cloudflare Workers:

```text
provider tests
TypeScript check
Wrangler deploy --dry-run
Wrangler dev --local when black-box HTTP behavior needs qualification
```

A Huram smoke workflow may consume this repository at an exact commit SHA. That workflow proves deployability/behavior; it does not become the runtime implementation.

Keep these boundaries separate:

```text
source implementation
    auth.net.im

HTTP primitive
    Hono

local/exact qualification
    Huram automation/worktree-automation

stable Cloudflare desired state / deployment policy
    Huram durable contracts
```

## Cloudflare provider rule

When Cloudflare functionality is exposed through Smoke, prefer a modular Cloudflare provider package rather than adding Cloudflare branches to Smoke core. Examples include deployment, Worker inventory, DNS inventory, and exact qualification helpers.

The primitive boundary should remain small:

```text
Smoke core
    composition
    command/provider contracts
    process lifecycle

provider/cloudflare
    Cloudflare API/Wrangler-specific behavior

Huram
    exact infrastructure authority and qualification evidence
```

Do not make Cloudflare itself a hidden special case in Smoke just because many early Smoke behaviors originated as Huram Cloudflare smoke tests.

## Security invariants

- Provider assertions are bearer credentials; never log them.
- Authentication responses use `Cache-Control: no-store`.
- Provider errors exposed to callers are bounded and do not include raw tokens, signing keys, or stack traces.
- Unknown providers fail closed.
- Provider configuration errors fail closed.
- JWT algorithms are explicitly allowlisted for asymmetric verification.
- Authorization is local policy over a cryptographically verified external identity.
- Authentication and authorization are separate conceptual steps even when implemented in one provider method.
- DNS, routing, runtime hosting, and identity authority are separate roles.

## Change protocol

For provider changes:

```text
1. update provider implementation
2. use Hono helpers for HTTP/JWT primitives where appropriate
3. add/update contract-focused unit tests
4. keep host provider-neutral
5. run npm test
6. run TypeScript check
7. run Wrangler deploy --dry-run
8. for HTTP/lifecycle changes, run Wrangler local black-box smoke
9. update README when user behavior changes
10. update this idiom file when architectural invariants change
```

Prefer the least-powerful new primitive. If a feature can be implemented as another provider under the existing contract, do that instead of expanding the host.

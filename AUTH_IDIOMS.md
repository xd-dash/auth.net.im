# auth.net.im idioms

This file is the maintenance contract for `xd-dash/auth.net.im`. `README.md` is the user-facing guide; this file records the architectural invariants that future changes should preserve unless a new requirement genuinely needs a different primitive.

## Roles

```text
Huram ABI
  qualifies, smoke-tests, promotes, and deploys exact infrastructure/runtime candidates

Cloudflare Worker
  hosts this HTTP runtime

Auth host
  owns provider-neutral routing and response normalization

Auth provider
  verifies one external assertion format and applies its local policy

External issuer
  owns the actual identity assertion and signing keys
```

Cloudflare is therefore a runtime/deployment provider here, not an authentication authority. GitHub is currently the first authentication provider.

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

Provider-specific claims must be normalized into that envelope. Do not make the Worker host understand GitHub-specific claims, Google-specific claims, Cloudflare Access claims, etc.

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

## GitHub provider

GitHub Actions OIDC is assertion verification, not token exchange.

The provider must:

```text
parse JWT structure
require RS256 + kid
require iss=https://token.actions.githubusercontent.com
require configured audience
check exp / nbf / iat with bounded skew
obtain GitHub JWKS
verify signature
apply local owner/repository/ref/workflow policy
normalize selected identity fields
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

Never trust `repository`, `ref`, `workflow_ref`, or any other claim for authorization until the signature has been verified. Cheap structural/issuer/audience/time rejection may happen before the JWKS fetch, but policy authority begins only after signature verification.

## Key handling

GitHub signing keys are public material. Warm Worker isolates may cache imported verification keys for a short bounded period. Unknown `kid` values must cause a fresh JWKS lookup and then fail closed if not present.

Private application credentials do not belong in this provider unless a later token-issuing capability explicitly needs them. If application secrets are added, use Worker secrets/bindings, never checked-in vars.

## Huram relationship

Huram remains the qualification and infrastructure control plane. `auth.net.im` should be locally qualified with the same Wrangler boundary Huram uses for Cloudflare Workers:

```text
TypeScript check
Wrangler deploy --dry-run
Wrangler dev --local when black-box HTTP behavior needs qualification
```

A Huram smoke workflow may consume this repository at an exact commit SHA. That workflow proves deployability/behavior; it does not become the runtime implementation.

Keep these boundaries separate:

```text
source implementation
    auth.net.im

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
- Authorization is local policy over a cryptographically verified external identity.
- Authentication and authorization are separate conceptual steps even when implemented in one provider method.
- DNS, routing, runtime hosting, and identity authority are separate roles.

## Change protocol

For provider changes:

```text
1. update provider implementation
2. add/update contract-focused unit tests
3. keep host provider-neutral
4. run npm test
5. run TypeScript check
6. run Wrangler deploy --dry-run
7. for HTTP/lifecycle changes, run Wrangler local black-box smoke
8. update README when user behavior changes
9. update this idiom file when architectural invariants change
```

Prefer the least-powerful new primitive. If a feature can be implemented as another provider under the existing contract, do that instead of expanding the host.

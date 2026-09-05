# auth.net.im idioms

This file is the maintenance contract for `xd-dash/auth.net.im`. `README.md` is the user-facing guide; this file records architectural invariants future changes should preserve unless a new requirement genuinely needs a different primitive.

## Roles

```text
qualification / deployment owner
  owns exact runtime policy and live qualification

Cloudflare Worker
  hosts this HTTP runtime

Hono
  owns HTTP routing/middleware composition

Auth provider
  verifies one external assertion format and applies supplied policy

External issuer
  owns the assertion and signing keys
```

Cloudflare is runtime/deployment, Hono is the HTTP primitive, and GitHub is currently the first authentication provider.

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

The reusable package is `@xd-dash/auth.net.im`.

Supported public subpaths are namespaced by role:

```text
@xd-dash/auth.net.im/core
    provider-neutral primitives

@xd-dash/auth.net.im/providers/github
    GitHubProvider
    GitHubEnv
    GitHubClaims
    GitHubProvider.middleware()
```

New authentication providers should follow `@xd-dash/auth.net.im/providers/<provider>`.

Do not expose framework directory layout as a second public provider surface. The conceptual public unit is the provider; `providers/` makes that role explicit at the package boundary.

Keep dependency direction:

```text
core
  ↑
provider primitive
  ↑
internal framework adapter
  ↑
providers/<provider> public composition surface
  ↑
application composition
```

The provider primitive consumes standard Web `Request` plus environment through `AuthInput`. Framework adapters may depend on provider primitives, never the reverse.

For GitHub, `GitHubProvider.middleware()` is a real static class API implemented by the public provider class, not an `Object.assign` mutation of the constructor. The internal Hono adapter may instantiate the framework-neutral base implementation directly to avoid circular module dependencies.

## Provider registry

The provider registry must remain type-safe. Do not erase provider environment contracts with `any`. As providers are added, define the application environment as the structural composition of the bindings required by the registered providers.

Provider names are normalized only for registry lookup. Authentication and authorization policy remain provider-owned.

## Policy ownership

Provider code owns policy semantics and configuration shape. It must not own one deployment's policy values.

Concrete values such as an organization name, repository name or ID, branch/ref allowlist, workflow path, audience, or deployment endpoint belong to the deployment/qualification authority. Do not embed those values in:

```text
src/
wrangler.jsonc
package tests
```

`GitHubEnv` is the generic binding contract for GitHub policy. Its field names are part of the provider API; the values are deployment inputs.

Package tests must use synthetic identities such as `example-org/example-repo`. Real workload identity verification belongs in an external qualification harness that injects real policy and obtains a real issuer assertion for an exact package revision.

## GitHub OIDC provider

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
validate required workload-identity claim types
    ↓
local owner/repository/id/ref/workflow policy supplied by deployment
    ↓
provider-neutral AuthIdentity
```

Required policy bindings:

```text
GITHUB_AUDIENCE
GITHUB_OWNER
GITHUB_REPOSITORIES
```

`GITHUB_REPOSITORIES` must resolve to at least one non-empty CSV entry. A syntactically present but empty list is provider misconfiguration, not an authorization miss.

Optional tightening:

```text
GITHUB_OWNER_ID
GITHUB_REPOSITORY_IDS
GITHUB_REFS
GITHUB_WORKFLOW_PREFIX
```

When immutable owner/repository IDs are configured they are additional requirements, not replacements for the readable names. Prefer configuring them for durable workload identity because names can be renamed or recycled while IDs are stable.

Required workload claims such as `repository`, `repository_owner`, and `run_id` must be non-empty strings at runtime. Never trust TypeScript claim types as a substitute for runtime validation of an externally supplied JWT payload.

Never use repository/ref/workflow claims as authorization authority until signature, issuer, audience, and time verification succeeds.

## Concurrency and state

Providers should be immutable/stateless after construction unless a feature explicitly requires shared state. Hono request-local identity belongs in `c.set("authIdentity", ...)`; do not put request identity in module globals or provider instance fields.

The current design has no request-shared mutable state and therefore no application-level data race between concurrent Worker requests.

Do not add an ad-hoc mutable JWKS cache merely to save a subrequest. If JWKS caching is needed, design explicit expiry, key-rotation refresh, single-flight behavior, and failure semantics, or use a platform/library primitive that already provides them.

## Replay semantics

OIDC assertions are bearer credentials and may be replayed until expiry. This provider validates assertions but deliberately does not maintain a `jti` replay ledger.

If a future endpoint exchanges an OIDC assertion for a one-time capability, add a durable replay primitive at that capability boundary. Do not hide replay state inside provider middleware where isolate replacement or concurrent isolates would make semantics inconsistent.

## HTTP contract

Canonical authentication route:

```text
POST /v1/auth/:provider
Authorization: Bearer <provider assertion>
```

Authentication and error responses must use `Cache-Control: no-store`. `401` authentication failures must emit a Bearer `WWW-Authenticate` challenge. Provider errors remain bounded and must never contain raw assertions, signing material, or stack traces.

## JWT primitive

Providers consuming JWT assertions should prefer Hono's JWT/JWK helpers over hand-rolled cryptography. Explicitly constrain acceptable algorithms and audience. Do not derive acceptable algorithms solely from an unverified JWT header.

Hono is pinned to an exact direct dependency version. Keep security-sensitive JWT/JWK behavior covered by exact-head CI qualification.

## Composition

Provider implementations live under:

```text
src/providers/<provider>/
```

Framework adapters may live under internal paths such as:

```text
src/<framework>/<provider>/
```

but useful provider-specific conveniences should be surfaced through the provider's public package subpath.

## Qualification

Package qualification should cover:

```text
synthetic provider policy tests
malformed external claim types
provider misconfiguration boundaries
cryptographic assertion verification with deterministic/local keys
public package import tests
middleware identity propagation
HTTP error/header behavior
TypeScript strict check
Wrangler deploy --dry-run without deployment policy
```

Deployment qualification should additionally cover:

```text
exact package revision
exact injected deployment policy
exact Worker startup/deploy boundary
real issuer assertion
real signature/JWKS verification
real workload claims against deployment policy
```

For provider/package changes:

```text
1. preserve the provider-neutral contract
2. keep framework concerns in thin adapters
3. keep public provider APIs cohesive
4. avoid `any` at provider composition boundaries
5. keep deployment values outside the package
6. add generic edge-case tests before relying on new policy
7. run npm test
8. run TypeScript check
9. run Wrangler deploy --dry-run
10. qualify real workload identity in the deployment owner when policy behavior changes
11. update README and this file when public behavior/invariants change
```

Prefer the least-powerful primitive that gives exact semantics.

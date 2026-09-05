import { bearerToken } from "../../auth/bearer"
import { AuthError } from "../../auth/error"
import type { AuthIdentity, AuthInput, AuthProvider } from "../../auth/types"

const GITHUB_ISSUER = "https://token.actions.githubusercontent.com"
const GITHUB_JWKS = `${GITHUB_ISSUER}/.well-known/jwks`
const CLOCK_SKEW_SECONDS = 30
const KEY_CACHE_SECONDS = 300

export type GitHubEnv = Record<string, string | undefined> & {
  GITHUB_AUDIENCE?: string
  GITHUB_OWNER?: string
  GITHUB_REPOSITORIES?: string
  GITHUB_REFS?: string
  GITHUB_WORKFLOW_PREFIX?: string
}

export type GitHubClaims = {
  iss?: string
  sub?: string
  aud?: string | string[]
  exp?: number
  nbf?: number
  iat?: number
  repository?: string
  repository_owner?: string
  ref?: string
  workflow_ref?: string
  run_id?: string
  actor?: string
}

type JwtHeader = {
  alg?: string
  kid?: string
}

type GitHubJwk = JsonWebKey & {
  kid?: string
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const keyCache = new Map<string, { key: CryptoKey; expiresAt: number }>()

function base64UrlDecode(value: string): ArrayBuffer {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/")
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

function decodePart<T>(value: string): T {
  return JSON.parse(decoder.decode(base64UrlDecode(value))) as T
}

function required(env: GitHubEnv, name: keyof GitHubEnv): string {
  const value = env[name]?.trim()
  if (!value) {
    throw new AuthError(500, "provider_misconfigured", `GitHub provider requires ${String(name)}`)
  }
  return value
}

function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean)
}

function audienceContains(claims: GitHubClaims, audience: string): boolean {
  const values = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : []
  return values.includes(audience)
}

export function authorizeGitHubClaims(claims: GitHubClaims, env: GitHubEnv): void {
  const owner = required(env, "GITHUB_OWNER")
  const repositories = csv(required(env, "GITHUB_REPOSITORIES"))

  if (!claims.repository || !claims.repository_owner || !claims.run_id) {
    throw new AuthError(403, "missing_workload_identity", "GitHub workload identity claims are incomplete")
  }
  if (claims.repository_owner !== owner) {
    throw new AuthError(403, "owner_forbidden", "GitHub repository owner is not authorized")
  }
  if (!repositories.includes(claims.repository)) {
    throw new AuthError(403, "repository_forbidden", "GitHub repository is not authorized")
  }

  const refs = csv(env.GITHUB_REFS)
  if (refs.length > 0 && (!claims.ref || !refs.includes(claims.ref))) {
    throw new AuthError(403, "ref_forbidden", "GitHub ref is not authorized")
  }

  const workflowPrefix = env.GITHUB_WORKFLOW_PREFIX?.trim()
  if (workflowPrefix && (!claims.workflow_ref || !claims.workflow_ref.startsWith(workflowPrefix))) {
    throw new AuthError(403, "workflow_forbidden", "GitHub workflow is not authorized")
  }
}

async function publicKey(kid: string, fetcher: typeof fetch, now: number): Promise<CryptoKey> {
  const cached = keyCache.get(kid)
  if (cached && cached.expiresAt > now) {
    return cached.key
  }

  const response = await fetcher(GITHUB_JWKS, {
    headers: { accept: "application/json" },
  })
  if (!response.ok) {
    throw new AuthError(503, "issuer_unavailable", "GitHub signing keys are unavailable")
  }

  const body = await response.json() as { keys?: GitHubJwk[] }
  const jwk = body.keys?.find(key => key.kid === kid)
  if (!jwk) {
    throw new AuthError(403, "unknown_signing_key", "GitHub signing key is not recognized")
  }

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  )
  keyCache.set(kid, { key, expiresAt: now + KEY_CACHE_SECONDS })
  return key
}

function normalizedIdentity(claims: GitHubClaims): AuthIdentity {
  const attributes: Record<string, string> = {}
  for (const [key, value] of Object.entries({
    repository: claims.repository,
    repository_owner: claims.repository_owner,
    ref: claims.ref,
    workflow_ref: claims.workflow_ref,
    run_id: claims.run_id,
    actor: claims.actor,
  })) {
    if (value) attributes[key] = value
  }

  const subject = claims.sub || `repo:${claims.repository}:ref:${claims.ref ?? ""}`
  return { provider: "github", subject, attributes }
}

export class GitHubProvider implements AuthProvider<GitHubEnv> {
  readonly name = "github"

  async authenticate(input: AuthInput<GitHubEnv>): Promise<AuthIdentity> {
    const token = bearerToken(input.request)
    const parts = token.split(".")
    if (parts.length !== 3 || parts.some(part => !part)) {
      throw new AuthError(403, "invalid_assertion", "GitHub OIDC assertion is malformed")
    }

    let header: JwtHeader
    let claims: GitHubClaims
    try {
      header = decodePart<JwtHeader>(parts[0])
      claims = decodePart<GitHubClaims>(parts[1])
    } catch {
      throw new AuthError(403, "invalid_assertion", "GitHub OIDC assertion is malformed")
    }

    if (header.alg !== "RS256" || !header.kid) {
      throw new AuthError(403, "invalid_algorithm", "GitHub OIDC assertion must use RS256 with a key id")
    }

    const audience = required(input.env, "GITHUB_AUDIENCE")
    const now = input.now ?? Math.floor(Date.now() / 1000)

    if (claims.iss !== GITHUB_ISSUER) {
      throw new AuthError(403, "issuer_forbidden", "GitHub OIDC issuer is not trusted")
    }
    if (!audienceContains(claims, audience)) {
      throw new AuthError(403, "audience_forbidden", "GitHub OIDC audience is not authorized")
    }
    if (!claims.exp || claims.exp <= now - CLOCK_SKEW_SECONDS) {
      throw new AuthError(403, "assertion_expired", "GitHub OIDC assertion is expired")
    }
    if (claims.nbf && claims.nbf > now + CLOCK_SKEW_SECONDS) {
      throw new AuthError(403, "assertion_not_yet_valid", "GitHub OIDC assertion is not yet valid")
    }
    if (claims.iat && claims.iat > now + CLOCK_SKEW_SECONDS) {
      throw new AuthError(403, "assertion_issued_in_future", "GitHub OIDC assertion has an invalid issued-at time")
    }

    const fetcher = input.fetcher ?? fetch
    const key = await publicKey(header.kid, fetcher, now)

    let signature: ArrayBuffer
    try {
      signature = base64UrlDecode(parts[2])
    } catch {
      throw new AuthError(403, "invalid_assertion", "GitHub OIDC assertion is malformed")
    }

    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      signature,
      encoder.encode(`${parts[0]}.${parts[1]}`),
    )
    if (!valid) {
      throw new AuthError(403, "invalid_signature", "GitHub OIDC signature is invalid")
    }

    authorizeGitHubClaims(claims, input.env)
    return normalizedIdentity(claims)
  }
}

export const github = new GitHubProvider()

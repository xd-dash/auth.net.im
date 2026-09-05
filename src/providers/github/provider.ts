import { decode, verifyWithJwks } from "hono/jwt"

import { bearerToken } from "../../auth/bearer"
import { AuthError } from "../../auth/error"
import type { AuthIdentity, AuthInput, AuthProvider } from "../../auth/types"

const GITHUB_ISSUER = "https://token.actions.githubusercontent.com"
const GITHUB_JWKS = `${GITHUB_ISSUER}/.well-known/jwks`

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

export type GitHubJwk = JsonWebKey & {
  kid: string
  alg?: string
}

type GitHubProviderOptions = {
  keys?: GitHubJwk[]
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
  readonly #keys?: GitHubJwk[]

  constructor(options: GitHubProviderOptions = {}) {
    this.#keys = options.keys
  }

  async authenticate(input: AuthInput<GitHubEnv>): Promise<AuthIdentity> {
    const token = bearerToken(input.request)
    const audience = required(input.env, "GITHUB_AUDIENCE")

    try {
      const { header } = decode(token)
      if (header.alg !== "RS256" || !header.kid) {
        throw new AuthError(403, "invalid_algorithm", "GitHub OIDC assertion must use RS256 with a key id")
      }

      const jwks = this.#keys
        ? { keys: this.#keys, allowedAlgorithms: ["RS256"] as const }
        : { jwks_uri: GITHUB_JWKS, allowedAlgorithms: ["RS256"] as const }

      const payload = await verifyWithJwks(token, {
        ...jwks,
        verification: {
          iss: GITHUB_ISSUER,
          aud: audience,
        },
      }) as GitHubClaims

      if (!payload.exp) {
        throw new AuthError(403, "missing_expiration", "GitHub OIDC assertion must include an expiration")
      }

      authorizeGitHubClaims(payload, input.env)
      return normalizedIdentity(payload)
    } catch (error) {
      if (error instanceof AuthError) {
        throw error
      }
      throw new AuthError(403, "invalid_assertion", "GitHub OIDC assertion is invalid")
    }
  }
}

export const github = new GitHubProvider()

import assert from "node:assert/strict"
import test from "node:test"

import { AuthError } from "../src/auth/error"
import { GitHubProvider, authorizeGitHubClaims, type GitHubEnv } from "../src/providers/github"

const env: GitHubEnv = {
  GITHUB_AUDIENCE: "https://service.example",
  GITHUB_OWNER: "example-org",
  GITHUB_REPOSITORIES: "example-org/example-repo",
  GITHUB_REFS: "refs/heads/main,refs/heads/release",
  GITHUB_WORKFLOW_PREFIX: "example-org/example-repo/.github/workflows/",
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url")
}

function assertAuthError(code: string) {
  return (error: unknown) => error instanceof AuthError && error.code === code
}

test("GitHub policy accepts a configured workload", () => {
  assert.doesNotThrow(() => authorizeGitHubClaims({
    repository: "example-org/example-repo",
    repository_owner: "example-org",
    run_id: "123",
    ref: "refs/heads/main",
    workflow_ref: "example-org/example-repo/.github/workflows/example.yml@refs/heads/main",
  }, env))
})

test("GitHub policy rejects an unconfigured ref", () => {
  assert.throws(() => authorizeGitHubClaims({
    repository: "example-org/example-repo",
    repository_owner: "example-org",
    run_id: "123",
    ref: "refs/heads/untrusted",
    workflow_ref: "example-org/example-repo/.github/workflows/example.yml@refs/heads/untrusted",
  }, env), assertAuthError("ref_forbidden"))
})

test("GitHub policy can bind immutable owner and repository ids", () => {
  const stableEnv: GitHubEnv = {
    ...env,
    GITHUB_OWNER_ID: "1001",
    GITHUB_REPOSITORY_IDS: "2001",
  }

  assert.doesNotThrow(() => authorizeGitHubClaims({
    repository: "example-org/example-repo",
    repository_id: "2001",
    repository_owner: "example-org",
    repository_owner_id: "1001",
    run_id: "123",
    ref: "refs/heads/main",
    workflow_ref: "example-org/example-repo/.github/workflows/example.yml@refs/heads/main",
  }, stableEnv))

  assert.throws(() => authorizeGitHubClaims({
    repository: "example-org/example-repo",
    repository_id: "9999",
    repository_owner: "example-org",
    repository_owner_id: "1001",
    run_id: "123",
    ref: "refs/heads/main",
    workflow_ref: "example-org/example-repo/.github/workflows/example.yml@refs/heads/main",
  }, stableEnv), assertAuthError("repository_id_forbidden"))
})

test("GitHub policy rejects malformed workload claim types", () => {
  const malformed = {
    repository: 123,
    repository_owner: "example-org",
    run_id: "123",
    ref: "refs/heads/main",
    workflow_ref: "example-org/example-repo/.github/workflows/example.yml@refs/heads/main",
  } as unknown as Parameters<typeof authorizeGitHubClaims>[0]

  assert.throws(() => authorizeGitHubClaims(malformed, env), assertAuthError("missing_workload_identity"))
})

test("GitHub policy treats an empty repository list as provider misconfiguration", () => {
  assert.throws(() => authorizeGitHubClaims({
    repository: "example-org/example-repo",
    repository_owner: "example-org",
    run_id: "123",
  }, {
    GITHUB_AUDIENCE: "https://service.example",
    GITHUB_OWNER: "example-org",
    GITHUB_REPOSITORIES: " , ",
  }), assertAuthError("provider_misconfigured"))
})

test("GitHub provider verifies an RS256 assertion with Hono JWT and normalizes identity", async () => {
  const keys = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )

  const publicJwk = await crypto.subtle.exportKey("jwk", keys.publicKey)
  const now = Math.floor(Date.now() / 1000)
  const header = encode({ alg: "RS256", typ: "JWT", kid: "test-kid" })
  const payload = encode({
    iss: "https://token.actions.githubusercontent.com",
    sub: "repo:example-org/example-repo:ref:refs/heads/main",
    aud: "https://service.example",
    iat: now - 5,
    nbf: now - 5,
    exp: now + 300,
    jti: "token-id",
    repository: "example-org/example-repo",
    repository_id: "2001",
    repository_owner: "example-org",
    repository_owner_id: "1001",
    ref: "refs/heads/main",
    workflow_ref: "example-org/example-repo/.github/workflows/example.yml@refs/heads/main",
    workflow_sha: "deadbeef",
    run_id: "123",
    run_attempt: "1",
    actor: "example-user",
    actor_id: "3001",
  })
  const signed = `${header}.${payload}`
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keys.privateKey,
    new TextEncoder().encode(signed),
  )
  const token = `${signed}.${Buffer.from(signature).toString("base64url")}`

  const request = new Request("https://service.example/v1/auth/github", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  })

  const identity = await new GitHubProvider({
    keys: [{ ...publicJwk, kid: "test-kid", alg: "RS256" }],
  }).authenticate({ request, env })

  assert.equal(identity.provider, "github")
  assert.equal(identity.subject, "repo:example-org/example-repo:ref:refs/heads/main")
  assert.equal(identity.attributes.repository, "example-org/example-repo")
  assert.equal(identity.attributes.repository_id, "2001")
  assert.equal(identity.attributes.run_id, "123")
  assert.equal(identity.attributes.jti, "token-id")
})

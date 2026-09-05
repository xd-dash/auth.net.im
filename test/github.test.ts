import assert from "node:assert/strict"
import test from "node:test"

import { AuthError } from "../src/auth/error"
import { GitHubProvider, authorizeGitHubClaims, type GitHubEnv } from "../src/providers/github"

const env: GitHubEnv = {
  GITHUB_AUDIENCE: "auth.net.im",
  GITHUB_OWNER: "xd-dash",
  GITHUB_REPOSITORIES: "xd-dash/huram-abi-master",
  GITHUB_REFS: "refs/heads/automation,refs/heads/worktree-automation",
  GITHUB_WORKFLOW_PREFIX: "xd-dash/huram-abi-master/.github/workflows/",
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url")
}

function assertAuthError(code: string) {
  return (error: unknown) => error instanceof AuthError && error.code === code
}

test("GitHub policy accepts the configured Huram execution rail", () => {
  assert.doesNotThrow(() => authorizeGitHubClaims({
    repository: "xd-dash/huram-abi-master",
    repository_owner: "xd-dash",
    run_id: "123",
    ref: "refs/heads/automation",
    workflow_ref: "xd-dash/huram-abi-master/.github/workflows/example.yml@refs/heads/automation",
  }, env))
})

test("GitHub policy rejects a different ref", () => {
  assert.throws(() => authorizeGitHubClaims({
    repository: "xd-dash/huram-abi-master",
    repository_owner: "xd-dash",
    run_id: "123",
    ref: "refs/heads/main",
    workflow_ref: "xd-dash/huram-abi-master/.github/workflows/example.yml@refs/heads/main",
  }, env), assertAuthError("ref_forbidden"))
})

test("GitHub policy can bind immutable owner and repository ids", () => {
  const stableEnv: GitHubEnv = {
    ...env,
    GITHUB_OWNER_ID: "271412537",
    GITHUB_REPOSITORY_IDS: "1357822489",
  }

  assert.doesNotThrow(() => authorizeGitHubClaims({
    repository: "xd-dash/huram-abi-master",
    repository_id: "1357822489",
    repository_owner: "xd-dash",
    repository_owner_id: "271412537",
    run_id: "123",
    ref: "refs/heads/automation",
    workflow_ref: "xd-dash/huram-abi-master/.github/workflows/example.yml@refs/heads/automation",
  }, stableEnv))

  assert.throws(() => authorizeGitHubClaims({
    repository: "xd-dash/huram-abi-master",
    repository_id: "999",
    repository_owner: "xd-dash",
    repository_owner_id: "271412537",
    run_id: "123",
    ref: "refs/heads/automation",
    workflow_ref: "xd-dash/huram-abi-master/.github/workflows/example.yml@refs/heads/automation",
  }, stableEnv), assertAuthError("repository_id_forbidden"))
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
    sub: "repo:xd-dash/huram-abi-master:ref:refs/heads/automation",
    aud: "auth.net.im",
    iat: now - 5,
    nbf: now - 5,
    exp: now + 300,
    jti: "token-id",
    repository: "xd-dash/huram-abi-master",
    repository_id: "1357822489",
    repository_owner: "xd-dash",
    repository_owner_id: "271412537",
    ref: "refs/heads/automation",
    workflow_ref: "xd-dash/huram-abi-master/.github/workflows/example.yml@refs/heads/automation",
    workflow_sha: "deadbeef",
    run_id: "123",
    run_attempt: "1",
    actor: "dash-xd",
    actor_id: "125025267",
  })
  const signed = `${header}.${payload}`
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keys.privateKey,
    new TextEncoder().encode(signed),
  )
  const token = `${signed}.${Buffer.from(signature).toString("base64url")}`

  const request = new Request("https://auth.net.im/v1/auth/github", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  })

  const identity = await new GitHubProvider({
    keys: [{ ...publicJwk, kid: "test-kid", alg: "RS256" }],
  }).authenticate({ request, env })

  assert.equal(identity.provider, "github")
  assert.equal(identity.subject, "repo:xd-dash/huram-abi-master:ref:refs/heads/automation")
  assert.equal(identity.attributes.repository, "xd-dash/huram-abi-master")
  assert.equal(identity.attributes.repository_id, "1357822489")
  assert.equal(identity.attributes.run_id, "123")
  assert.equal(identity.attributes.jti, "token-id")
})

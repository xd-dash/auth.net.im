import assert from "node:assert/strict"
import test from "node:test"

import worker from "../src/index"

const env = {
  GITHUB_AUDIENCE: "auth.net.im",
  GITHUB_OWNER: "xd-dash",
  GITHUB_REPOSITORIES: "xd-dash/huram-abi-master",
}

test("lists composed providers", async () => {
  const response = await worker.fetch(new Request("https://auth.net.im/v1/providers"), env)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { providers: ["github"] })
})

test("normalizes unknown providers", async () => {
  const response = await worker.fetch(new Request("https://auth.net.im/v1/auth/missing", { method: "POST" }), env)
  assert.equal(response.status, 404)
  assert.deepEqual(await response.json(), {
    authenticated: false,
    error: {
      code: "unknown_provider",
      message: "authentication provider is not available",
    },
  })
})

test("normalizes missing provider assertions", async () => {
  const response = await worker.fetch(new Request("https://auth.net.im/v1/auth/github", { method: "POST" }), env)
  assert.equal(response.status, 401)
  const body = await response.json() as { authenticated: boolean; error: { code: string } }
  assert.equal(body.authenticated, false)
  assert.equal(body.error.code, "missing_bearer")
})

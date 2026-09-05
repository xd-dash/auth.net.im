import assert from "node:assert/strict"
import test from "node:test"

import worker from "../src/index"

const env = {
  GITHUB_AUDIENCE: "https://service.example",
  GITHUB_OWNER: "example-org",
  GITHUB_REPOSITORIES: "example-org/example-repo",
}

test("lists composed providers", async () => {
  const response = await worker.fetch(new Request("https://service.example/v1/providers"), env)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { providers: ["github"] })
})

test("normalizes unknown providers without caching the response", async () => {
  const response = await worker.fetch(new Request("https://service.example/v1/auth/missing", { method: "POST" }), env)
  assert.equal(response.status, 404)
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.deepEqual(await response.json(), {
    authenticated: false,
    error: {
      code: "unknown_provider",
      message: "authentication provider is not available",
    },
  })
})

test("missing provider assertions return a Bearer challenge and no-store", async () => {
  const response = await worker.fetch(new Request("https://service.example/v1/auth/github", { method: "POST" }), env)
  assert.equal(response.status, 401)
  assert.equal(response.headers.get("www-authenticate"), "Bearer")
  assert.equal(response.headers.get("cache-control"), "no-store")
  const body = await response.json() as { authenticated: boolean; error: { code: string } }
  assert.equal(body.authenticated, false)
  assert.equal(body.error.code, "missing_bearer")
})

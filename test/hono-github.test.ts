import assert from "node:assert/strict"
import test from "node:test"

import { Hono } from "hono"

import type { AuthProvider } from "@xd-dash/auth.net.im/core"
import {
  middleware as github,
  type GitHubEnv,
} from "@xd-dash/auth.net.im/providers/github"

const provider: AuthProvider<GitHubEnv> = {
  name: "github",
  async authenticate() {
    return {
      provider: "github",
      subject: "repo:xd-dash/example:ref:refs/heads/main",
      attributes: {
        repository: "xd-dash/example",
      },
    }
  },
}

test("GitHub provider package surface exposes middleware.auth and normalized identity", async () => {
  const app = new Hono<{
    Bindings: GitHubEnv
    Variables: {
      authIdentity: {
        provider: string
        subject: string
        attributes: Record<string, string>
      }
    }
  }>()

  app.use("/protected/*", github.auth({ provider }))
  app.get("/protected/value", c => c.json(c.get("authIdentity")))

  const response = await app.request("https://example.test/protected/value", {}, {})
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    provider: "github",
    subject: "repo:xd-dash/example:ref:refs/heads/main",
    attributes: {
      repository: "xd-dash/example",
    },
  })
})

import { Hono } from "hono"

import { AuthError } from "./auth/error"
import type { AuthFailure, AuthSuccess } from "./auth/types"
import { getProvider, providerNames } from "./providers"
import type { GitHubEnv } from "./providers/github"

export type Env = GitHubEnv

type AppEnv = {
  Bindings: Env
}

function response(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
    },
  })
}

const app = new Hono<AppEnv>()

app.get("/healthz", c => c.json({ ok: true }))

app.get("/v1/providers", c => c.json({ providers: providerNames() }))

app.post("/v1/auth/:provider", async c => {
  const provider = getProvider(c.req.param("provider"))
  if (!provider) {
    const body: AuthFailure = {
      authenticated: false,
      error: { code: "unknown_provider", message: "authentication provider is not available" },
    }
    return response(body, 404)
  }

  try {
    const identity = await provider.authenticate({
      request: c.req.raw,
      env: c.env,
    })
    const body: AuthSuccess = { authenticated: true, identity }
    return response(body)
  } catch (error) {
    if (error instanceof AuthError) {
      const body: AuthFailure = {
        authenticated: false,
        error: { code: error.code, message: error.message },
      }
      return response(body, error.status)
    }

    console.error("auth provider failure", error)
    const body: AuthFailure = {
      authenticated: false,
      error: { code: "provider_failure", message: "authentication provider failed" },
    }
    return response(body, 500)
  }
})

app.notFound(() => response({ error: "not_found" }, 404))

export default app

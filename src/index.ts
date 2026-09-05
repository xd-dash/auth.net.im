import { Hono } from "hono"

import { AuthError } from "./auth/error"
import type { AuthFailure, AuthIdentity, AuthSuccess } from "./auth/types"
import { githubAuth } from "./hono/github"
import { getProvider, providerNames } from "./providers"
import type { GitHubEnv } from "./providers/github"

export type Env = GitHubEnv

type AppEnv = {
  Bindings: Env
  Variables: {
    authIdentity: AuthIdentity
  }
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

app.onError((error) => {
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
})

app.get("/healthz", c => c.json({ ok: true }))

app.get("/v1/providers", c => c.json({ providers: providerNames() }))

// The canonical Worker consumes the same reusable Hono adapter exported to
// downstream Workers. This keeps the package surface exercised by the app.
app.use("/v1/auth/github", githubAuth())
app.post("/v1/auth/github", c => {
  const body: AuthSuccess = {
    authenticated: true,
    identity: c.get("authIdentity"),
  }
  return response(body)
})

// Future providers can use the provider-neutral primitive directly until they
// gain an optional Hono adapter of their own.
app.post("/v1/auth/:provider", async c => {
  const provider = getProvider(c.req.param("provider"))
  if (!provider) {
    const body: AuthFailure = {
      authenticated: false,
      error: { code: "unknown_provider", message: "authentication provider is not available" },
    }
    return response(body, 404)
  }

  const identity = await provider.authenticate({
    request: c.req.raw,
    env: c.env,
  })
  const body: AuthSuccess = { authenticated: true, identity }
  return response(body)
})

app.notFound(() => response({ error: "not_found" }, 404))

export default app

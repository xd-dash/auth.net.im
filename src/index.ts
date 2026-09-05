import { AuthError } from "./auth/error"
import type { AuthFailure, AuthSuccess } from "./auth/types"
import { getProvider, providerNames } from "./providers"
import type { GitHubEnv } from "./providers/github"

export type Env = GitHubEnv

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
    },
  })
}

async function authenticate(request: Request, env: Env, providerName: string): Promise<Response> {
  const provider = getProvider(providerName)
  if (!provider) {
    const body: AuthFailure = {
      authenticated: false,
      error: { code: "unknown_provider", message: "authentication provider is not available" },
    }
    return json(body, 404)
  }

  try {
    const identity = await provider.authenticate({ request, env })
    const body: AuthSuccess = { authenticated: true, identity }
    return json(body)
  } catch (error) {
    if (error instanceof AuthError) {
      const body: AuthFailure = {
        authenticated: false,
        error: { code: error.code, message: error.message },
      }
      return json(body, error.status)
    }
    console.error("auth provider failure", error)
    const body: AuthFailure = {
      authenticated: false,
      error: { code: "provider_failure", message: "authentication provider failed" },
    }
    return json(body, 500)
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === "GET" && url.pathname === "/healthz") {
      return json({ ok: true })
    }

    if (request.method === "GET" && url.pathname === "/v1/providers") {
      return json({ providers: providerNames() })
    }

    const match = /^\/v1\/auth\/([a-z0-9_-]+)$/.exec(url.pathname)
    if (request.method === "POST" && match) {
      return authenticate(request, env, match[1])
    }

    return json({ error: "not_found" }, 404)
  },
}

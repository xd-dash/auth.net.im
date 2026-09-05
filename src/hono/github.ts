import type { MiddlewareHandler } from "hono"

import type { AuthIdentity } from "../auth/types"
import { GitHubProvider, type GitHubEnv } from "../providers/github"

export type GitHubAuthVariables = {
  authIdentity: AuthIdentity
}

export type GitHubAuthEnv = {
  Bindings: GitHubEnv
  Variables: GitHubAuthVariables
}

export type GitHubAuthOptions = {
  provider?: GitHubProvider
}

export function githubAuth(options: GitHubAuthOptions = {}): MiddlewareHandler<GitHubAuthEnv> {
  const provider = options.provider ?? new GitHubProvider()

  return async (c, next) => {
    const identity = await provider.authenticate({
      request: c.req.raw,
      env: c.env,
    })

    c.set("authIdentity", identity)
    await next()
  }
}

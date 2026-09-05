import { githubAuth } from "../../hono/github"
import { GitHubProvider as GitHubProviderBase } from "./provider"

export {
  authorizeGitHubClaims,
  github,
} from "./provider"

export type {
  GitHubClaims,
  GitHubEnv,
  GitHubJwk,
} from "./provider"

export type {
  GitHubAuthEnv,
  GitHubAuthOptions,
  GitHubAuthVariables,
} from "../../hono/github"

export const GitHubProvider = Object.assign(GitHubProviderBase, {
  middleware: githubAuth,
})

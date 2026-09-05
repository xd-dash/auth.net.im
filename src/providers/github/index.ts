import { githubAuth, type GitHubAuthOptions } from "../../hono/github"
import { GitHubProvider as GitHubProviderBase } from "./provider"

export {
  authorizeGitHubClaims,
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

export class GitHubProvider extends GitHubProviderBase {
  static middleware(options: GitHubAuthOptions = {}) {
    return githubAuth(options)
  }
}

export const github = new GitHubProvider()

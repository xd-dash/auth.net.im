export {
  GitHubProvider,
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

export { githubAuth } from "../../hono/github"

import { githubAuth } from "../../hono/github"

export const middleware = {
  auth: githubAuth,
}

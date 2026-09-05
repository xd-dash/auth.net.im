import type { AuthProvider } from "../auth/types"
import { github, type GitHubEnv } from "./github"

export type ProviderEnv = GitHubEnv

type RegisteredProvider = AuthProvider<ProviderEnv>

const providers = new Map<string, RegisteredProvider>([
  [github.name, github],
])

export function getProvider(name: string): RegisteredProvider | undefined {
  return providers.get(name.trim().toLowerCase())
}

export function providerNames(): string[] {
  return [...providers.keys()].sort()
}

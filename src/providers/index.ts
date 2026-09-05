import type { AuthProvider } from "../auth/types"
import { github } from "./github"

const providers = new Map<string, AuthProvider<any>>([
  [github.name, github],
])

export function getProvider(name: string): AuthProvider<any> | undefined {
  return providers.get(name.trim().toLowerCase())
}

export function providerNames(): string[] {
  return [...providers.keys()].sort()
}

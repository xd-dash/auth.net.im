export type AuthEnv = Record<string, string | undefined>

export type AuthAttributes = Record<string, string>

export type AuthIdentity = {
  provider: string
  subject: string
  attributes: AuthAttributes
}

export type AuthInput<E extends AuthEnv = AuthEnv> = {
  request: Request
  env: E
  now?: number
  fetcher?: typeof fetch
}

export interface AuthProvider<E extends AuthEnv = AuthEnv> {
  readonly name: string
  authenticate(input: AuthInput<E>): Promise<AuthIdentity>
}

export type AuthSuccess = {
  authenticated: true
  identity: AuthIdentity
}

export type AuthFailure = {
  authenticated: false
  error: {
    code: string
    message: string
  }
}

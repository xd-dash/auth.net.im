import { AuthError } from "./error"

export function bearerToken(request: Request): string {
  const authorization = request.headers.get("authorization")
  if (!authorization) {
    throw new AuthError(401, "missing_bearer", "missing bearer token")
  }

  const [scheme, token, extra] = authorization.trim().split(/\s+/)
  if (scheme?.toLowerCase() !== "bearer" || !token || extra) {
    throw new AuthError(401, "invalid_bearer", "invalid bearer token")
  }
  return token
}

# auth.net.im

`auth.net.im` is a lightweight Cloudflare Worker authentication gateway built around composable authentication providers.

The Worker host owns HTTP routing and response normalization. Providers own verification and provider-specific authorization policy. The first provider is GitHub Actions OIDC.

Canonical API:

```text
POST /v1/auth/:provider
Authorization: Bearer <provider assertion>
```

The provider-neutral contract is defined in `src/auth/types.ts`. Provider composition is explicit in `src/providers/index.ts`.

## GitHub Actions OIDC

The GitHub provider verifies GitHub's RS256-signed OIDC assertion, checks issuer/audience/time validity, and applies local repository/ref/workflow policy from Worker environment variables.

Required Worker vars:

```text
GITHUB_AUDIENCE=auth.net.im
GITHUB_OWNER=xd-dash
GITHUB_REPOSITORIES=xd-dash/huram-abi-master
GITHUB_REFS=refs/heads/automation,refs/heads/worktree-automation
GITHUB_WORKFLOW_PREFIX=xd-dash/huram-abi-master/.github/workflows/
```

GitHub workflow permissions:

```yaml
permissions:
  contents: read
  id-token: write
```

Request a token for the configured audience and call the provider:

```sh
response="$(
  curl -fsS \
    -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
    "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=auth.net.im"
)"

jwt="$(jq -r .value <<<"$response")"

curl -fsS \
  -X POST \
  -H "Authorization: Bearer $jwt" \
  https://auth.net.im/v1/auth/github
```

Successful responses use the same provider-neutral identity envelope regardless of provider:

```json
{
  "authenticated": true,
  "identity": {
    "provider": "github",
    "subject": "repo:xd-dash/huram-abi-master:ref:refs/heads/automation",
    "attributes": {
      "repository": "xd-dash/huram-abi-master",
      "repository_owner": "xd-dash",
      "ref": "refs/heads/automation",
      "workflow_ref": "xd-dash/huram-abi-master/.github/workflows/example.yml@refs/heads/automation",
      "run_id": "123456789",
      "actor": "dash-xd"
    }
  }
}
```

## Composition rule

Provider-specific code belongs under `src/providers/<provider>/`. A provider exports the shared `AuthProvider` contract and is registered in `src/providers/index.ts`. Do not add provider-specific branching to the Worker host.

Cloudflare is the runtime/deployment provider here, not the authentication authority. The authentication authority remains whichever provider verifies the incoming assertion.

## Local qualification

```sh
npm install
npm test
npm run check
npm run dev
```

`npm run check` uses Wrangler's dry-run deploy path, matching the local Cloudflare Worker qualification idiom used by Huram.

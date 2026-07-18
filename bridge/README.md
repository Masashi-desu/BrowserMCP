# BrowserMCP Cross-platform Bridge

`@browsermcp/bridge` is the small local process between standard MCP clients and BrowserMCP-enabled web apps. It listens only on `127.0.0.1`, exposes one MCP Streamable HTTP endpoint, and forwards capability discovery and invocation over the separate BrowserMCP Bridge Protocol.

It contains no application-specific tools or site business logic. Tools, resources, and prompts exist only while their browser runtime is connected.

The daemon uses Node.js APIs only and is designed to run with the same package and CLI on macOS,
Linux, and Windows. The current repository verification was performed on Apple Silicon macOS;
Linux, Windows, and Intel Mac remain implementation-supported but not yet execution-verified.

## Requirements

- Node.js 24 or later and npm 11 or later
- A supported macOS, Linux, or Windows release
- A current browser with WebSocket support
- An MCP client that supports Streamable HTTP and custom request headers
- For an HTTPS-hosted web app: a locally trusted certificate containing `localhost` and `127.0.0.1` SANs
- To generate development certificates with the repository helper: an `openssl` executable on
  `PATH`

## Start

From the repository root:

```sh
npm run build
npm run start:bridge
```

The Bridge prints the following secrets exactly once:

- a startup-scoped MCP bearer token;
- a separate status/admin token;

The command is the same on each platform. Use a normal terminal on macOS, a shell on Linux, or a
one-line PowerShell command on Windows:

```powershell
npm run start:bridge
```

The CLI is a foreground process and stops on the platform's normal interrupt. The package does not
install launchd, systemd, or a Windows service. OS-specific lifecycle integration is separate; the
repository supplies the native menu-bar lifecycle app only for macOS.

Bridge credentials are generated with 256 bits of entropy, are never written to configuration, and their known token formats are redacted from Bridge logs and the state API. Restarting rotates both startup-scoped bearer tokens. Redaction also recognizes normalized credential field, query, and assignment names such as `apiKey`, `api_key`, `accessToken`, `clientSecret`, and `privateKey`; it is a defense-in-depth allow-list, not general-purpose secret or DLP detection. Callers must not put arbitrary credentials into diagnostic messages or unrecognized fields.

Supported options:

```text
--port <number>          default 8789
--allow-origin <origin>  exact browser Origin; repeatable
--pair-origin <origin>   allow the Origin and issue a one-time token; repeatable
--tls-cert <path>        PEM certificate; requires --tls-key
--tls-key <path>         PEM private key; requires --tls-cert
--json                   one machine-readable ready event on stdout
```

Normal startup keeps the human-readable output used by existing workflows. Native shells and
service supervisors can add `--json`; successful startup then writes exactly one JSON line to
stdout, while diagnostic logs remain on stderr:

```json
{"type":"ready","mcpEndpoint":"http://127.0.0.1:8789/mcp","mcpToken":"<token>","browserEndpoint":"ws://127.0.0.1:8789/browser","statusEndpoint":"http://127.0.0.1:8789/","adminToken":"<token>","pairingTokens":[{"origin":"https://app.example","token":"<token>","expiresAt":1800000000000}]}
```

Environment equivalents are `BROWSERMCP_PORT`, `BROWSERMCP_ALLOWED_ORIGINS` (comma-separated), `BROWSERMCP_TLS_CERT`, `BROWSERMCP_TLS_KEY`, and the documented `BROWSERMCP_*` limit variables shown by `--help`.

The host is deliberately not configurable. Both HTTP and TLS modes bind IPv4 loopback only.

## Native macOS lifecycle app

`macOS/BrowserMCPApp.xcodeproj` provides an optional SwiftUI/AppKit menu-bar app for macOS 14+.
It starts and supervises this same Bridge through `--json`; it does not reimplement MCP, routing,
authentication, or BrowserMCP Bridge Protocol state. The app prefers the dependency-bundled
`browsermcp-bridge.mjs` resource and can use this package's `dist/cli.js` during repository
development. JavaScript dependencies are bundled into the app resource, but Node.js 24 is not.

The app persists non-secret launch preferences only. Startup credentials and live process state
remain in memory. It is an unsigned local-development app, not a signed/notarized distribution.
Its App Sandbox is disabled to launch external Node and use operator-selected files; see
[`../macOS/README.md`](../macOS/README.md) for the native trust boundary and verification steps.

## MCP client configuration

Use the endpoint and MCP token printed at startup. Conceptually:

```json
{
  "url": "http://127.0.0.1:8789/mcp",
  "headers": {
    "Authorization": "Bearer <startup MCP token>"
  }
}
```

`POST`, `GET`, and `DELETE` on `/mcp` all require the bearer token. A high-entropy, in-memory MCP session ID is created by the official `@modelcontextprotocol/sdk` Streamable HTTP transport. Browser-originated MCP requests are rejected; the browser uses `/browser`, not `/mcp`.

## Approve a web app

The normal browser flow sends a credential-free approval request. The Bridge keeps the socket in a
bounded pending state and shows its exact observed Origin, app identity, runtime identity, and
deadline in the authenticated management page. Verify those values and choose **Approve** or
**Reject**. No session or capability registration exists before approval, and no credential is
returned to the page. Rejected and expired requests close; duplicate and excessive pending
requests are rate-limited.

The `--pair-origin` flag and `/api/pairing-tokens` remain supported as a legacy compatibility path
for clients that cannot wait for the protocol approval response. Those tokens are short-lived,
single-use, and exact-Origin-bound; they are not the default site workflow.

Non-loopback web apps must use an HTTPS Origin. Plain `http:` is accepted only for local development
on `localhost` or `127.0.0.1`; the CLI, environment configuration, and status API all reject a
remote HTTP Origin before issuing authority to code that could be replaced in transit.

The management login exchanges the admin bearer for an `HttpOnly; SameSite=Strict` session cookie (`Secure` in TLS mode). Approval and legacy-token mutations additionally require a session-bound CSRF token and an exact same-origin `Origin`/`Host` combination. API automation may instead use the non-ambient admin bearer. For example, legacy token issuance is:

```sh
curl \
  -H "Authorization: Bearer <admin token>" \
  -H "Content-Type: application/json" \
  --data '{"origin":"https://app.example"}' \
  http://127.0.0.1:8789/api/pairing-tokens
```

For normal approval, the web library sends `{ kind: "approval" }` and waits for `welcome`; the
Bridge management API decides the pending request by ID. For legacy pairing, the token is sent only
inside the first protocol `connect` message. Tokens are never accepted in URLs. In every mode the
Bridge checks that the declared Origin equals the browser-controlled WebSocket `Origin` header.

Successful connection returns a short-lived resume token. Resume tokens are bound to the session,
Origin, app ID, runtime ID, and instance ID. Each successful resume consumes and rotates the token.
Replay, expiration, identity mismatch, and a fresh pairing that duplicates an active runtime are
rejected.

A valid resume for the same bound session may replace its own half-open former transport. The
Bridge removes the old routes and pending work before accepting the replacement, then requires the
browser to republish its current registrations. A fresh pairing or a credential for a different
session cannot take over an active runtime.

Protocol v1 treats `tools`, `resources`, `prompts`, `cancellation`, `session-resume`, and `heartbeat` as one required feature set. A peer advertising only a subset is rejected with `CAPABILITY_UNSUPPORTED` before its pairing or resume credential is consumed. A normal tab disconnect may resume while its rotating credential remains valid. A `BRIDGE_STOPPING` disconnect is explicitly non-resumable because all resume credentials are process-local and disappear with the Bridge.

## HTTPS/WSS for public static sites

An HTTPS page may require a trusted WSS loopback connection, especially in Safari. Generate development material without automatically trusting it:

```sh
npm run tls:generate -- .browsermcp/tls
```

The Node helper invokes OpenSSL without a shell, uses platform-native path handling, refuses unsafe
or symlink output directories and existing files, and leaves four durable PEM files: the CA
certificate/key and localhost certificate/key. It never changes a trust store. Inspect and
manually trust only the generated local CA if appropriate: use Keychain trust on macOS, the
distribution/browser trust mechanism on Linux, or the Windows certificate store on Windows. Then
start:

```sh
npm run start:bridge -- \
  --tls-cert .browsermcp/tls/localhost-cert.pem \
  --tls-key .browsermcp/tls/localhost-key.pem
```

The endpoints become `https://127.0.0.1:8789/mcp` and `wss://127.0.0.1:8789/browser`. `localhost:<port>` is also accepted as an exact Host for certificate and client convenience, but the process still binds only `127.0.0.1`.

`GET /health` returns only `{"status":"ok"}`. It emits CORS and legacy Private Network Access
headers for any syntactically eligible HTTPS or loopback-development Origin so a first-time page
can request local access before approval. It exposes no state or authorization decision.
`OPTIONS /health` supports local-network permission preflight. All other APIs remain non-CORS.

## Dynamic routing and conflicts

The Bridge keeps a transport-independent registry keyed by browser connection and registration ID.

- Tool and prompt MCP names are `<sanitized-app-id>_<app-hash>_<origin-hash>__<local-name>` and never exceed 128 characters. Both hashes use 16 hexadecimal SHA-256 characters (64 bits); the readable app prefix is limited to 20 characters to preserve the MCP name bound.
- Resource URIs use `browsermcp://app-<app-hash>-<origin-hash>/<encoded-source-uri>` with the same 64-bit namespaces.
- A resource handler receives its registered local source URI. Version 0.1 models one exact resource per registration: every returned content item must repeat that local URI, and the Bridge rewrites it to the requested namespaced MCP URI. Mismatched or ad-hoc subresource URIs are rejected, as is a second registration of the same exact URI inside one runtime.
- Different app IDs and Origins therefore remain separated.
- Multiple tabs for the same app, Origin, and capability share the same exposed MCP name. Invocation is rejected with an explicit `AMBIGUOUS_TARGET` error until only one provider remains; the Bridge never silently chooses a tab.
- Duplicate runtime identity or names that collide after MCP-safe normalization are rejected.
- Disconnect immediately removes every registration owned by that connection and rejects its in-flight requests.

Registry changes produce standard MCP `notifications/tools/list_changed`, `notifications/resources/list_changed`, and `notifications/prompts/list_changed` notifications for active MCP sessions. Churn is coalesced per primitive kind over a 25 ms event-loop window, bounding notification fan-out without delaying discovery materially.

## Limits and cancellation

Defaults are intentionally finite:

- 1 MiB HTTP request body;
- 1 MiB WebSocket message;
- 128 simultaneous HTTP/WebSocket connections, 100 headers, and 1,000 requests per keep-alive socket;
- 10 second HTTP header, 30 second complete-request intake, and 5 second keep-alive deadlines, checked at most once per second (the active SSE response timeout remains disabled);
- 16 browser connections;
- 64 global in-flight browser invocations;
- 8 invocations per runtime;
- 64 MCP sessions, with 15 minute idle expiry and a 60 second sweep; active POST/GET/SSE requests are never evicted;
- 256 registrations and 2 MiB of serialized registration data per browser runtime;
- 2,048 registrations and 16 MiB of serialized registration data across the Bridge;
- 30 second browser invocation timeout;
- 5 second unauthenticated WebSocket handshake timeout;
- at most half the browser-connection limit in pending approvals, at most three per Origin, and one
  pending request per app/runtime/instance tuple;
- 2 minute pairing-token lifetime;
- 5 minute, rotating resume-token lifetime.

Registration count and byte checks happen before mutation, so a rejected registration never leaves partial state. The default per-runtime count is deliberately above the Docs app's 46-capability set. MCP tool schemas are normalized to an object root and malformed `properties`, `required`, output-schema, or annotation metadata is filtered at the standard MCP boundary, so a browser definition cannot corrupt `tools/list`. Resource annotations are reduced to the valid standard `audience`, `priority`, and `lastModified` subset; protocol-level prompt annotations are intentionally ignored because standard MCP prompts have no annotations field. Browser image/audio data and resource blobs must use canonical Base64, and invocation results are independently checked against the MCP SDK result schemas before returning them.

MCP cancellation aborts the pending broker request and sends a Bridge Protocol `cancel` message. Timeout does the same. Late-response tombstones expire after the request timeout, are swept on every insertion/lookup, and are capped at `max(32, 2 × global concurrency)`. Browser `INVOCATION_TIMEOUT` and `INVOCATION_CANCELLED` errors retain their timeout/cancel outcome even when they win a race with the local deadline. Browser errors, disconnects, cancellations, and timeouts are converted to bounded, redacted MCP-safe failures. Resource and prompt failures use standard MCP JSON-RPC errors; tool failures return `isError: true` so an MCP model can recover.

Every tunable limit read from the environment is listed below. Values are positive base-10 integers;
header timeout must not exceed request-intake timeout, per-runtime limits must not exceed their
Bridge-wide counterparts, browser request timeout must not exceed 600,000 ms, per-runtime
concurrency must not exceed 10,000, and the WebSocket payload limit must be from 1,024 through
1,048,576 bytes. The upper bound matches the Protocol library's outbound-message validator, so
the Bridge never advertises a frame size that its senders cannot produce.
These invariants and the fixed `127.0.0.1` host are checked again at the public JavaScript
constructor boundary; TypeScript casts cannot bypass them.

| Environment variable | Default |
| --- | ---: |
| `BROWSERMCP_REQUEST_TIMEOUT_MS` | `30000` |
| `BROWSERMCP_HTTP_HEADERS_TIMEOUT_MS` | `10000` |
| `BROWSERMCP_HTTP_REQUEST_TIMEOUT_MS` | `30000` |
| `BROWSERMCP_HTTP_KEEP_ALIVE_TIMEOUT_MS` | `5000` |
| `BROWSERMCP_MAX_CONCURRENT_REQUESTS` | `64` |
| `BROWSERMCP_MAX_CONCURRENT_PER_RUNTIME` | `8` |
| `BROWSERMCP_MAX_HTTP_BODY_BYTES` | `1048576` |
| `BROWSERMCP_MAX_HTTP_CONNECTIONS` | `128` |
| `BROWSERMCP_MAX_MCP_SESSIONS` | `64` |
| `BROWSERMCP_MCP_SESSION_IDLE_TTL_MS` | `900000` |
| `BROWSERMCP_MCP_SESSION_SWEEP_INTERVAL_MS` | `60000` |
| `BROWSERMCP_MAX_REGISTRATIONS_PER_RUNTIME` | `256` |
| `BROWSERMCP_MAX_REGISTRATIONS_TOTAL` | `2048` |
| `BROWSERMCP_MAX_REGISTRATION_BYTES_PER_RUNTIME` | `2097152` |
| `BROWSERMCP_MAX_REGISTRATION_BYTES_TOTAL` | `16777216` |
| `BROWSERMCP_MAX_WS_PAYLOAD_BYTES` | `1048576` |

## Status UI and state API

The authenticated local UI shows:

- process and endpoint state;
- connected apps, exact Origins, versions, runtime and instance IDs;
- published tools, resources, and prompts;
- recent requests, duration, bounded result summaries, failures, and timeouts;
- recent structured, redacted logs;
- pending exact-Origin approvals with explicit Approve/Reject actions;
- legacy exact-Origin pairing-token issuance inside a collapsed compatibility section.

`GET /api/state` accepts the admin bearer or UI session cookie. It never returns bearer, pairing, resume, or UI-session tokens. The Bridge keeps only bounded in-memory recent history; restart clears sessions, registrations, logs, and request history.

## Security boundaries

- **MCP client → Bridge:** localhost is not trusted. Every request requires the startup bearer. Host is exactly `127.0.0.1:<actual-port>` or `localhost:<actual-port>` to reduce DNS-rebinding risk.
- **Web app → Bridge:** exact observed-Origin equality, explicit operator approval before session
  establishment, bounded pending state, identity-bound rotating resume, strict protocol parsing,
  size/concurrency/time limits, and no token-in-URL flow.
- **Bridge → web app:** the Bridge forwards only registered generic protocol operations; it does not grant filesystem or network authority beyond what the browser app itself implements.
- **Status user → Bridge:** separate bearer/session, same-origin validation, CSRF protection, no-store responses, CSP, no framing, and redacted bounded diagnostic data.

TLS protects the local hop only after the user has chosen and trusted an appropriate local CA. The
repository helper does not modify any operating-system or browser trust store. No signing,
notarization, deployment, or external publication is performed by the Bridge.

## Development and verification

From the repository root or with the workspace selector:

```sh
npm run typecheck --workspace @browsermcp/bridge
npm run test:unit --workspace @browsermcp/bridge
npm run test:integration --workspace @browsermcp/bridge
npm run build --workspace @browsermcp/bridge
```

Integration tests use the official MCP client and real loopback HTTP, WebSocket, HTTPS, and WSS servers. They cover initialization/session routing, all three capability kinds, dynamic unregister, browser absence/disconnect, error/timeout/cancel conversion, concurrent correlation, strict Origin, invalid/replayed authentication, malformed messages, resume rotation, Host/bearer/CSRF enforcement, health PNA headers, and TLS certificate use.

All Bridge package scripts use Node.js, TypeScript, or Vitest directly and do not assume a POSIX
shell. Tests build temporary paths with `node:path`/`node:os`; the TLS generator integration suite
also checks SANs, private-key permissions where POSIX modes apply, and refusal of unsafe,
symlinked, or pre-populated output locations. Those checks have been run on macOS only in this
repository revision. Linux and Windows should run the same commands with Node.js 24 and OpenSSL,
but are explicitly unverified until recorded on those hosts.

## Known constraints

- State is intentionally in memory; restarting invalidates MCP/UI sessions, browser resume credentials, and registrations. A tab receiving `BRIDGE_STOPPING` must clear its resume credential and wait for fresh pairing rather than reconnecting with it.
- The cross-platform package is a foreground Node.js process. The native macOS app is the provided
  optional lifecycle layer; Linux/Windows shells, OS service installation, release auto-start,
  signing, notarization, and update systems are not provided.
- Only IPv4 loopback is bound. `localhost` URLs must resolve to IPv4 or clients should use `127.0.0.1`.
- Ambiguous same-app tabs require the user to close duplicate providers; explicit per-invocation tab selection is not part of protocol version 1.1.0.

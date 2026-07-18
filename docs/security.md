# Security model

BrowserMCP treats loopback networking as a transport property, not an authorization boundary.
Local malware, another user process, and an arbitrary website may all attempt to reach a loopback
port. No connection becomes trusted merely because it uses `localhost`.

## Trust boundaries

| Boundary | Authentication | Authorization scope |
| --- | --- | --- |
| MCP client to `/mcp` | Per-process bearer credential | List and invoke currently registered browser capabilities |
| Browser to `/browser` | Explicit operator approval of the exact observed Origin, or a legacy one-time pairing credential; rotated resume credential thereafter | Register and execute capabilities published by code running under that Origin/session |
| Operator to status API | Independent admin credential exchanged for a short session | Read bridge status/history/logs, approve or reject a waiting exact-Origin request, and optionally issue a legacy one-time token; never invoke capabilities |
| Native macOS app to Bridge child process | Explicit executable selection plus child-process ownership; structured ready output is consumed locally | Start, stop, restart, and present this process's endpoints, credentials, and diagnostics |

The three network credential scopes are mutually rejected at the other network boundaries. Their
values are generated from a cryptographic random source, held in memory, compared without
data-dependent early exit where applicable, and never intentionally written to normal logs. The
native app receives the child process's MCP/admin values through its private stdout pipe so it can
present them and authenticate status polling; it does not create a fourth reusable credential.

The native app is an operator-facing lifecycle shell, not another protocol authority. It never
persists MCP/admin credentials, pairing/resume credentials, or live Bridge state. It may persist
only non-secret launch preferences such as the selected Node/Bridge executable, port, allowed and
paired Origins, TLS paths, and whether to start the Bridge when the app launches. Credential copy
is explicit and clears the pasteboard after 60 seconds if it still contains that credential. Its
single-file Bridge resource bundles JavaScript dependencies but not Node.js itself. Selecting an
untrusted Node or Bridge executable would execute that program with the user's privileges, so
executable selection is part of the local operator trust boundary. The macOS App Sandbox is
disabled to permit launching external Node and using operator-selected certificate/script paths;
the app must therefore remain a thin local process controller and must not be treated as a sandbox
containment boundary.

## Network and HTTP controls

- The server binds explicitly to `127.0.0.1`; it does not listen on LAN interfaces. The public
  constructor revalidates and snapshots this host and all limits at runtime, so a JavaScript caller
  or later mutation cannot replace the listener address.
- Requests require the expected loopback `Host`, mitigating DNS rebinding.
- MCP authentication is checked for every Streamable HTTP method and session request.
- Browser upgrades are accepted only on the browser path and from a syntactically eligible HTTPS
  Origin or loopback HTTP development Origin. Opening a transport creates no authority. Exact
  equality with the declared Origin is required, and registration is unavailable before approval.
- Public or otherwise non-loopback web Origins must use HTTPS. Plain HTTP Origins are accepted only
  for local development on `localhost` or `127.0.0.1`, preventing a network attacker from replacing
  a paired application's code in transit.
- Public HTTPS pages connect through WSS with an operator-generated loopback certificate. The
  bridge reads configured certificate/key files but never installs a CA or weakens browser TLS.
- The unauthenticated `/health` response exposes only `{ "status": "ok" }` and sends CORS headers
  to any syntactically eligible Origin, enabling the Local Network Access check that must precede a
  first approval request. No state, identity, or authorization decision is disclosed.
- Administrative data is returned only after an independent authenticated session. The UI session
  cookie is HttpOnly, SameSite=Strict, Secure in TLS mode, expiring, and state changes require a
  session-bound CSRF token plus same-Origin checks.
- Request bodies and WebSocket frames have fixed maximum sizes.
- Unknown routes, methods, protocol messages, fields, and incompatible versions are rejected.

## Browser pairing

The browser normally requests access without receiving a credential. The Bridge holds that socket
in a bounded, short-lived pending state and shows the exact observed Origin plus page-declared app
and runtime identity in the independently authenticated management page. The operator must choose
Approve or Reject. No session exists, and no capability may register or run, before Approve. On
approval the Bridge records the exact Origin for the process lifetime, establishes the waiting
session, and mints a short-lived resume credential bound to the observed Origin and declared tuple.
Reject and expiry close the socket without authority. Global, per-Origin, and duplicate-runtime
limits bound unsolicited requests.

Legacy clients may use a short-lived, single-use pairing token issued by the authenticated Bridge
admin surface. The page sends it only in the protocol handshake; it is not placed in a WebSocket
URL. The token is bound to the exact observed Origin. A URL path is never an Origin boundary.
App ID/name/version, runtime ID, instance ID, and display names remain page-declared routing
metadata, not independently authenticated principals. Reconnection must match the approved tuple
and rotates the resume token, preventing replay of the previous credential.

All code sharing one Origin has the same browser security principal. In particular, every project
site below `https://OWNER.github.io/...` shares the Origin `https://OWNER.github.io`, regardless of
repository path. Pair only when every script, repository site, service worker, and stored asset on
that Origin is trusted to exercise the paired authority. Use a dedicated custom hostname/Origin
for BrowserMCP when that shared trust is inappropriate; paths cannot provide isolation.

The browser library keeps resume credentials in memory by default. The site has no token field: it
submits the approval request and displays only its non-secret request ID, Origin, and expiry. Legacy
applications that choose token pairing remain responsible for obtaining that one-time token through
an operator-approved channel and must not persist it.

The site persists only one allowlisted, non-secret display-locale string in `localStorage`.
Language changes preserve the in-memory Connection URL draft and never copy authentication state
into web storage, a URL, the translation catalog, or a log. Unknown/tampered locale values are ignored,
and storage denial falls back to browser-language detection.

## Invocation controls

- Capability definitions are validated and namespaced before exposure.
- Per-runtime and bridge-wide concurrency limits prevent unbounded work.
- Every call has a maximum deadline; expired calls are cancelled on both sides.
- MCP cancellation propagates to an `AbortSignal` in the browser handler.
- A disconnect removes all routes owned by that session and rejects its pending work.
- Browser error details are normalized before MCP conversion; stack traces and credentials are not
  returned to clients.
- Recent-request and log buffers are bounded and redact BrowserMCP token formats, bearer data, URL userinfo, and an allow-list of normalized credential field/query/assignment names (for example `apiKey`, `accessToken`, `clientSecret`, and `privateKey`). Log entries are deep-frozen internally and deep-cloned for each external reader. This is defense in depth, not arbitrary-secret or DLP detection; application code must not log credentials under unrecognized names or in free-form text.

## Web application responsibility

Pairing authorizes a web application to publish capabilities; it does not make every handler safe.
Application authors must still validate tool arguments, minimize resource scope, request browser
permissions at the point of use, avoid exposing secrets, and honor cancellation. The generic
bridge deliberately has no application-specific allow/deny logic.

## Operational guidance

1. Allow only exact Origins you control. Use a dedicated development port rather than a wildcard.
2. Do not paste MCP, admin, pairing, or resume credentials into chat, issue reports, or source files.
3. Restart the bridge if terminal output or process memory may have been exposed; all volatile
   authority is then revoked.
4. Treat connected browser capabilities as code execution with the privileges of that Origin and
   browser profile.
5. Keep the Bridge, Node.js LTS, browser, and native app source/build updated.

Trusting a local CA is security-sensitive. Protect or destroy its signing key after issuing the
loopback leaf certificate, never deploy either private key, and remove the CA from the macOS,
Linux, Windows, or browser-specific trust store when it is no longer needed. Do not disable TLS
verification to make a published site connect. The repository never changes a trust store
automatically.

Publicly trusted TLS termination, remote access, secret persistence, automatic discovery, code
signing, notarization, bundled Node.js, and OS service installation are out of scope. Exposing the
Bridge through a proxy or changing its bind address is unsupported and invalidates this threat
model.

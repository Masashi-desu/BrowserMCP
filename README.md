# BrowserMCP

BrowserMCP is a local-first foundation for using a browser tab as an MCP runtime.
An MCP client connects to one common local Bridge over standard MCP Streamable HTTP. The Bridge
discovers the Tools, Resources, and Prompts declared by connected web applications and forwards
calls through a separate, authenticated BrowserMCP Bridge Protocol. The handler itself runs in the
browser, where it can use JavaScript, Web Workers, WebAssembly, IndexedDB, Canvas, and other Web
APIs.

```text
MCP client
  | standard MCP Streamable HTTP + MCP bearer token
  v
Cross-platform BrowserMCP Bridge on 127.0.0.1
  | BrowserMCP Bridge Protocol + operator-approved exact Origin
  v
BrowserMCP web app
  +-- declarative Tools / Resources / Prompts
  +-- Worker / WASM / IndexedDB / browser APIs
```

The Bridge is generic: it contains routing, authentication, limits, and MCP conversion, but no
business logic for a particular web application. A static web app needs no app-specific backend.
Both local Vite pages and public HTTPS pages such as GitHub Pages can connect to the user's local
Bridge. Published HTTPS pages use a locally trusted WSS endpoint; the browser requests access and
the operator approves the exact Origin in the local Bridge management page. The static page does
not need a token field.

This repository includes a GitHub Pages workflow that verifies the complete workspace and deploys
only `site/dist` after a push to `main`. It does **not** publish packages or releases,
sign/notarize an app, publish Bridge credentials, or expose the local Bridge externally.
The deployed site is
[`https://masashi-desu.github.io/BrowserMCP/`](https://masashi-desu.github.io/BrowserMCP/).

The canonical product contract is [`docs/specification.md`](./docs/specification.md), together
with the scoped normative documents it identifies under `docs`. Those documents supersede the
initial development plan and are kept in sync with the implementation and verification record.

## Repository layout

| Path | Responsibility |
| --- | --- |
| `packages/protocol` | Versioned, runtime-validated BrowserMCP Bridge Protocol; no standard MCP dependency |
| `packages/web` | Framework-independent declarative BrowserMCP web library |
| `bridge` | Cross-platform Node.js Bridge, standard MCP/WebSocket endpoints, routing, security, and authenticated status UI |
| `macOS` | Native SwiftUI/AppKit menu-bar app that starts and supervises the shared Node.js Bridge |
| `site` | Vite landing page, structured documentation, connection UI, and browser-owned MCP capabilities |
| `tests/integration` | Full MCP client → Bridge → real site capability round trips |
| `docs` | Canonical specification, architecture, protocol, security, public-static-site setup, design decisions, and verification record |
| `scripts` | Reproducible local TLS helper and repository utilities |

The dependency direction is `protocol ← web ← site` and `protocol ← bridge`. Only the Node.js
Bridge imports the official standard MCP SDK. The macOS app is a lifecycle/UI shell: it launches
the same Bridge and does not duplicate MCP conversion, routing, authentication, or site logic.

The static site has a dependency-free, typed i18n layer for English, Japanese, Simplified Chinese,
Spanish, Hindi, Arabic, Brazilian Portuguese, Bengali, and Russian. It detects the browser
preference, provides an explicit selector, persists only the allowlisted locale, and applies RTL
layout for Arabic without changing hash routes, Docs IDs, or the BrowserMCP session. Every
advertised locale has a complete UI message catalog; a unit test rejects missing keys. Technical
prose is translated for every locale through stable page/section overlays. Code, commands, URLs,
API names, MCP identifiers, and machine-readable Docs responses retain the canonical English
corpus so translations cannot alter executable or protocol meaning.

## Minimum requirements and verified platforms

- The cross-platform Bridge requires Node.js 24 LTS or newer and npm 11 or newer. It is designed
  for current macOS, Linux, and Windows releases and uses the same CLI, configuration, PEM TLS
  inputs, loopback endpoints, and wire protocols on each.
- A current stable Safari, Chrome/Chromium, Firefox, or Edge release.
- An MCP client that supports MCP `2026-07-28`, Streamable HTTP, and custom HTTP headers.
- Loopback HTTP(S) and WebSocket traffic permitted by local security software.
- The native menu-bar app requires macOS 14 or newer, Node.js 24 or newer, and current stable Xcode
  to build. Node.js is deliberately not embedded in the app.
- For a public HTTPS web app: a loopback certificate trusted by the browser and permission for any
  Local Network Access prompt or policy enforced by that browser.

Only Apple Silicon macOS has been exercised in this repository. The recorded environment is
macOS 26.5.2, Node.js 24.10.0, npm 11.6.0, and Xcode 26.6. Linux, Windows, and Intel Mac are
implementation targets but are **not yet verified support claims**; reproducible checks and their
expected results are in [`docs/verification.md`](./docs/verification.md).

## Local setup and first round trip

Install and verify the workspace:

```sh
npm install
npm run check
```

Start the Bridge:

```sh
npm run start:bridge
```

The Bridge prints, once, an MCP endpoint/token, browser endpoint, management URL, and admin token.
Keep that terminal private. In a second terminal:

```sh
npm run dev:site
```

Open `http://127.0.0.1:4173/#/connection`, keep the local `ws://127.0.0.1:8789/browser`
endpoint, and choose **Request approval**. Open the Bridge management URL, authenticate with the
admin token, verify the exact Origin/app identity, and approve the waiting request. No browser-side
credential is copied or persisted.

Configure one common Bridge entry in an MCP client using the endpoint and MCP bearer token printed
by that same process:

```json
{
  "mcpServers": {
    "browsermcp": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:8789/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_TOKEN_FROM_BRIDGE_STARTUP>"
      }
    }
  }
}
```

Configuration keys vary by client, but the URL and authorization header are the same. The bearer
is startup-scoped and held only in Bridge memory; restarting the Bridge revokes it.

### Platform-specific operation

The Bridge package and arguments are identical; only OS lifecycle and CA trust differ:

- **macOS:** Run the npm command above in Terminal, or use the native app below. The CLI stays in
  the foreground and stops on `Ctrl+C`. For WSS, the Node TLS helper needs OpenSSL on `PATH`, and
  the generated public CA is trusted manually in the login Keychain.
- **Linux:** Run the same npm command in a shell. The CLI stays in the foreground; optional
  systemd/user-service integration is not provided. For WSS, install OpenSSL for the helper and
  trust only the public CA through the distribution and active browser's documented mechanism.
- **Windows:** From PowerShell, use the one-line command
  `npm run start:bridge`. The process remains attached to
  that console; a Windows service is not installed. For WSS, put OpenSSL on `PATH`, run
  `npm run tls:generate -- .browsermcp/tls`, and import only `ca-cert.pem` into the current user's
  Trusted Root Certification Authorities store.

All three paths bind only `127.0.0.1` and accept the same PEM, Origin, port, limit, and `--json`
configuration. Linux, Windows, and Intel Mac instructions are implementation guidance, not a claim
that those hosts were exercised in this revision.

### Native macOS menu-bar app

macOS users can run the same Bridge through the native app instead of supervising the CLI in a
terminal. Build the unsigned local-development app with:

```sh
xcodebuild \
  -project macOS/BrowserMCPApp.xcodeproj \
  -scheme BrowserMCPApp \
  -configuration Debug \
  -derivedDataPath /tmp/BrowserMCPDerivedData \
  CODE_SIGNING_ALLOWED=NO \
  build
```

Launch the resulting `BrowserMCP.app`. Its menu-bar icon shows the Bridge lifecycle state and
opens a SwiftUI management window. The window can start, stop, and restart the Bridge; select or
detect Node.js 24 and the Bridge executable; display MCP/browser/status endpoints; reveal or copy
a startup credential only on an explicit action; open the authenticated status UI to approve or
reject waiting exact-Origin requests; issue legacy pairing tokens when explicitly needed; show app,
session, and capability counts; and show
Bridge output and lifecycle errors.

The app prefers its single-file `browsermcp-bridge.mjs` resource and uses `bridge/dist/cli.js` as a
repository-development fallback. JavaScript dependencies are bundled into that resource, but the
Node.js runtime is not. The macOS App Sandbox is disabled so the app can launch that external
runtime and use operator-selected files; executable selection is therefore a local trust decision.
The app persists only non-secret launch settings such as executable paths,
port, Origins, TLS paths, and whether to start the Bridge when the app launches. MCP/admin
credentials and current process state remain in memory and are revoked when the Bridge stops.
Credential-copy actions clear the pasteboard after 60 seconds when its content is unchanged. The
local build is not signed, notarized, packaged for distribution, or published.

See [`macOS/README.md`](./macOS/README.md) for Xcode tests, executable resolution, menu/UI behavior,
and the manual lifecycle verification procedure.

## Use the web library

The library registers handlers synchronously and publishes them after an authenticated connection.
The default URL is secure `wss://127.0.0.1:8789/browser`; explicitly choose `ws:` only for an HTTP
local-development page.

```ts
import { BrowserMCP } from "@browsermcp/web";

const app = new BrowserMCP({
  name: "Example App",
  version: "0.1.0",
  appId: "example.app",
  bridgeUrl:
    location.protocol === "https:"
      ? "wss://127.0.0.1:8789/browser"
      : "ws://127.0.0.1:8789/browser",
  prepareLocalNetworkAccess: location.protocol === "https:",
});

const handle = app.tool({
  name: "current_page",
  description: "Return the browser-owned current page",
  inputSchema: { type: "object", additionalProperties: false },
  handler: async (_arguments, { signal }) => {
    signal.throwIfAborted();
    return {
      content: [{ type: "text", text: `${location.origin}${location.pathname}` }],
      structuredContent: { origin: location.origin, pathname: location.pathname },
    };
  },
});

await app.connect();
await handle.ready;
```

`tool`, `resource`, and `prompt` return handles with `ready` and `unregister()`. Handlers receive an
`AbortSignal`, invocation/session IDs, the effective timeout, and a redacting diagnostic logger.
Expose only page data needed by the capability. In particular, avoid returning `location.href`: query strings
and fragments can contain credentials or other user-controlled sensitive values.
See [`packages/web/README.md`](./packages/web/README.md) for lifecycle, reconnection, cancellation,
state subscription, and all public options.

The build emits ESM artifacts under `packages/web/dist`, suitable for npm packaging, normal
bundlers, or direct static ESM hosting. Direct hosting places both the Protocol and Web `dist`
trees on the same static Origin and resolves their package names with a browser import map; the
exact HTML is in [`packages/web/README.md`](./packages/web/README.md). npm and CDN publication are
intentionally out of scope.

## Public HTTPS static apps and GitHub Pages

`site` uses relative Vite assets and hash routes, so it works below a repository subpath without a
server rewrite:

```sh
VITE_BASE_PATH=/BrowserMCP/ npm run build:site
```

PowerShell users set `$env:VITE_BASE_PATH = "/BrowserMCP/"`, run `npm run build:site`, then remove
the process-scoped variable with `Remove-Item Env:VITE_BASE_PATH`.

The output is `site/dist`. A published HTTPS page must use
`wss://127.0.0.1:8789/browser`; it cannot safely depend on insecure `ws:` behavior. BrowserMCP
includes an opt-in credential-free `/health` probe for certificate, Origin, and Local Network
Access diagnostics. The Bridge supports operator-supplied TLS material while remaining bound only
to IPv4 loopback.

Non-loopback HTTP pages are rejected for both `ws:` and `wss:` Bridge URLs because the page and
pairing flow could be modified before transport authentication. Plain HTTP is supported only for
local development Origins on `localhost` or `127.0.0.1`.

GitHub Pages repository paths do not isolate trust: every
`https://OWNER.github.io/<REPOSITORY>/` project shares the Origin `https://OWNER.github.io`. Approve
only if all content on that Origin is trusted, or use a dedicated custom hostname/Origin for
BrowserMCP. Approval cannot be scoped to one repository path.

The complete reproducible certificate, trust, Bridge, Pages-subpath, browser, and MCP-client setup
is in [`docs/public-static-sites.md`](./docs/public-static-sites.md). The cross-platform
Node/OpenSSL helper (`npm run tls:generate -- .browsermcp/tls`) creates local keys but never changes
an OS trust store, disables TLS checks, or deploys secrets.
The guide separates macOS, Linux, and Windows certificate/trust procedures.

The pinned-action workflow at [`.github/workflows/pages.yml`](./.github/workflows/pages.yml) runs
`npm ci` and `npm run check`, obtains the repository/custom-domain base path from GitHub Pages,
rebuilds the site with that exact `VITE_BASE_PATH`, uploads only `site/dist`, and deploys through the
protected `github-pages` environment. The deploy job has only `pages: write` and `id-token: write`;
the build job has read-only repository access. GitHub Pages must use **GitHub Actions** as its
publishing source.

[Deployment run 29643866925](https://github.com/Masashi-desu/BrowserMCP/actions/runs/29643866925)
passed the full gate and published the repository site. An isolated installed-Chrome check then
completed public HTTPS → loopback WSS → exact-Origin approval → browser-hosted Docs Tool → official
MCP SDK response. The verification used context-scoped TLS and Local Network Access exceptions and
did not modify the OS trust store; the exact scope is recorded in
[`docs/verification.md`](./docs/verification.md).

## Site and Docs MCP

The entire site is one BrowserMCP application. Route changes update current-page context without
creating another runtime. Its connection view shows session state, registration status, recent
browser executions, latest result, safe errors, logs, and a reconnect action.

The visual documentation and Docs MCP use the same typed corpus rather than scraping the DOM. The
Docs MCP exposes purpose-built search, exact page/section retrieval, API/type/example lookup,
troubleshooting, implementation guides, responsibility lookup, capability/status lookup, and
related-document discovery. It also exposes page resources and setup/implementation/diagnostic
prompts. Results include stable page and section IDs, logical paths, base-independent hash-router
`href` values, source identifiers, status, constraints, examples, and next references.

In addition, safe site-wide capabilities report page/site/runtime/registration state, demonstrate
bounded IndexedDB JSON storage, execute abortable text analysis in a Web Worker, and expose a shared
Three.js Rubik's Cube benchmark. The benchmark Tools inspect state, apply bounded move sequences,
scramble or reset the cube, and control autoplay; `browsermcp://benchmark/rubiks-cube/state` exposes
the live state as a Resource. These handlers remain in `site`; no site-specific logic is present in
the Bridge.

## Multiple applications and tabs

The browser handshake reports app ID/name/version, exact Origin, runtime ID, and instance/tab ID.
Only the observed Origin is a browser-authenticated principal; app/runtime/instance fields are
self-declared routing metadata. After exact-Origin approval, the resume credential is bound to that
tuple. The Bridge exposes tools and prompts as a bounded MCP-safe namespace derived from app ID and
an Origin hash; resources are mapped to a namespaced `browsermcp:` URI.

Different apps/Origins do not collide. Multiple tabs that publish the same capability for the same
app and Origin share the public name, but invocation fails with `AMBIGUOUS_TARGET` until exactly one
provider remains. The Bridge never silently chooses a tab. Disconnect removes all routes and
rejects pending work owned by that runtime.

## Security model

Loopback is transport scope, not trust. The implementation therefore enforces:

- explicit `127.0.0.1` binding and strict loopback `Host` validation;
- an MCP bearer checked on every MCP request;
- explicit operator approval of the exact observed Origin before session establishment, with
  bounded/expiring pending requests and legacy one-time tokens only as a compatibility path;
- identity-bound resume credentials that rotate after every successful resume;
- an independent admin/UI credential, HttpOnly strict cookie, same-Origin checks, and CSRF tokens;
- strict message schemas, version negotiation, size/depth/count limits, bounded concurrency and
  deadlines, cancellation propagation, and atomic disconnect cleanup;
- bounded diagnostic history and secret redaction in logs, state, and client-visible errors;
- trusted WSS for secure public pages without automatic trust installation or TLS bypasses.

Read [`docs/security.md`](./docs/security.md) before embedding sensitive browser capabilities. The
Bridge authorizes a paired Origin to publish generic capabilities; each web app remains responsible
for argument validation, least privilege, permission prompts, user-gesture requirements, and safe
handling of its own data.

## Development and quality commands

Run these from the repository root:

| Command | Purpose |
| --- | --- |
| `npm run format` | Write Biome formatting |
| `npm run format:check` | Verify formatting without changing files |
| `npm run lint` | Run Biome static analysis |
| `npm run typecheck` | Run strict TypeScript checks in every workspace |
| `npm run test:unit` | Run workspace unit suites |
| `npm run test:integration` | Run cross-boundary and workspace integration suites |
| `npm test` | Run all automated tests |
| `npm run build` | Build protocol, web library, Bridge, and static site in dependency order |
| `npm run check` | Format, lint, typecheck, test, and build all JavaScript/TypeScript artifacts |
| `xcrun swift-format lint --strict --recursive macOS/BrowserMCPApp macOS/BrowserMCPAppTests` | Check native Swift formatting |
| `xcodebuild -project macOS/BrowserMCPApp.xcodeproj -scheme BrowserMCPApp -configuration Debug -derivedDataPath .build/xcode-analyze CODE_SIGNING_ALLOWED=NO analyze` | Run native Xcode static analysis |
| `xcodebuild -project macOS/BrowserMCPApp.xcodeproj -scheme BrowserMCPApp -configuration Debug -derivedDataPath /tmp/BrowserMCPDerivedData CODE_SIGNING_ALLOWED=NO build` | Build the unsigned native macOS app |
| The same `xcodebuild` command ending in `test` | Run native macOS app tests |

The Xcode build/tests are separate from `npm run check` so the cross-platform Bridge workflow does
not require macOS or Xcode.

Bridge integration and browser verification bind local ports; sandboxed execution environments may
need explicit permission for loopback listeners. No test requires LAN or Internet exposure.

Protocol details and state transitions are documented in
[`docs/bridge-protocol.md`](./docs/bridge-protocol.md). Architectural boundaries and delegated
choices are in [`docs/architecture.md`](./docs/architecture.md) and
[`docs/design-decisions.md`](./docs/design-decisions.md). The command evidence, environment-dependent
manual procedures, and item-by-item Definition of Done audit are recorded in
[`docs/verification.md`](./docs/verification.md).

## Current constraints and roadmap

- Bridge state and all credentials are intentionally in memory; a restart requires MCP
  reconfiguration and browser re-pairing.
- The cross-platform Bridge is a Node.js process. It does not install an OS service or login item,
  or mutate certificate trust on macOS, Linux, or Windows.
- The macOS menu-bar app is implemented as an unsigned local-development `.app`, but requires an
  external Node.js 24+ runtime and is not sandboxed. It is not notarized, packaged for
  distribution, or auto-updated.
- Only Apple Silicon macOS has been verified. Linux, Windows, and Intel Mac behavior remains
  unverified even though the Bridge has no intentional OS-specific runtime dependency.
- Only IPv4 loopback is bound. Remote/LAN use and cloud relays are unsupported.
- Resource registration currently supports exact URIs, not URI templates or subscriptions.
- Same-app duplicate-tab invocation is rejected rather than offering per-call tab selection.
- Browser permissions, secure-context rules, same-origin policy, tab lifetime, Local Network Access
  policy, and user-gesture requirements cannot be bypassed by BrowserMCP.
- Top-level published-site MCP verification requires the deployed HTTPS Origin, a browser profile
  that trusts the chosen local CA, and a user decision for any Local Network Access prompt. The
  Pages workflow publishes only the static site; trusted loopback WSS remains explicit local setup.

Possible future work includes signed/notarized macOS packaging, bundling an appropriate Node.js
runtime, Keychain-backed optional credential flows, OS-native Linux/Windows lifecycle shells, URI
templates/subscriptions, explicit runtime selection, package publication, and additional platform
and browser automation. None of those are claimed as implemented.

## Contributing

Keep standard MCP conversion inside `bridge`, the native lifecycle/UI shell inside `macOS`, the
internal protocol inside `packages/protocol`, reusable browser transport/lifecycle behavior inside `packages/web`, and
application business logic inside the web app. Add runtime validation and tests for wire changes,
update both code and documentation, avoid fixed secrets, and run `npm run check` before proposing a
change. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the development checklist.

## License

MIT. See [`LICENSE`](./LICENSE).

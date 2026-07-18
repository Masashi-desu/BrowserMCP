# Verification and Definition of Done

This is the durable completion record for the canonical specification set rooted at
[`specification.md`](./specification.md). It separates automated evidence from checks that require
an externally published Origin, a user-managed browser profile, or a third-party MCP client. Pages
deployment status is recorded below. No package/release publication, Keychain mutation, signing,
or notarization was performed.

## Verified environment

| Item | Value |
| --- | --- |
| Date | 2026-07-18 |
| Host | Apple Silicon (`arm64`) Mac |
| macOS | 26.5.2 |
| Node.js | 24.10.0 |
| npm | 11.6.0 |
| Xcode | 26.6; used for the unsigned native macOS app build/tests |
| TypeScript | 7.0.2, strict mode |
| Vite | 8.1.5 |
| MCP SDK | `@modelcontextprotocol/sdk` 1.29.0 |

## Automated quality record

The repository-root commands below completed successfully on the environment above.

| Gate | Command | Result |
| --- | --- | --- |
| Formatting | `npm run format:check` | Passed |
| Static analysis | `npm run lint` | Biome passed; cross-platform Node TLS/bundle scripts passed syntax checks |
| Type checking | `npm run typecheck` | Passed for root integration types and all four workspaces |
| Unit tests | `npm run test:unit` | 167 passed: Protocol 16, Web 51, Bridge 53, Site 47 |
| Integration tests | `npm run test:integration` | 46 passed: Bridge 26, Site/Docs 16, root site-WSS/bundled-Bridge/Pages-workflow 4 |
| Build | `npm run build` | Protocol/Web ESM/types, Bridge ESM/types/CLI plus single-file bundle, and Vite site built |
| Bridge package dry run | `npm pack --dry-run --workspace @browsermcp/bridge` | Passed; package resolves from root `bridge` without the former platform path |
| Native macOS formatting | `xcrun swift-format lint --strict --recursive macOS/BrowserMCPApp macOS/BrowserMCPAppTests` | Passed with Swift Format 6.3.0 |
| Native macOS static analysis | `xcodebuild -project macOS/BrowserMCPApp.xcodeproj -scheme BrowserMCPApp -configuration Debug -derivedDataPath .build/xcode-analyze CODE_SIGNING_ALLOWED=NO analyze` | Passed |
| Native macOS tests | `xcodebuild -project macOS/BrowserMCPApp.xcodeproj -scheme BrowserMCPApp -configuration Debug -destination 'platform=macOS,arch=arm64' -derivedDataPath .build/xcode CODE_SIGNING_ALLOWED=NO test` | 10 passed on Apple Silicon macOS |
| Native macOS build | `xcodebuild -project macOS/BrowserMCPApp.xcodeproj -scheme BrowserMCPApp -configuration Debug -derivedDataPath .build/xcode CODE_SIGNING_ALLOWED=NO build` | Unsigned 2.0 MB arm64 Debug `BrowserMCP.app` built with the Bridge bundle |
| Pages base build | `VITE_BASE_PATH=/BrowserMCP/ npm run build:site` | Passed; assets emitted below the explicit repository base |
| Pages workflow definition | `.github/workflows/pages.yml` | Pinned actions, read-only build permissions, full `npm run check`, Pages `base_path`, artifact-only upload, separate OIDC deploy job; remote execution pending |
| Dependency audit | `npm audit --audit-level=low` | 0 vulnerabilities |

### Local built-site browser check

The explicit-base production artifact was served locally at `/BrowserMCP/` and checked in an
isolated Chromium session at 1440×1000 and 390×844. Hash routing, the landing page, Docs search and
section navigation, the Connection view, and the 19/23/4 capability counts behaved as documented.
Asset requests stayed under `/BrowserMCP/`, the clean-load console
had no errors, and the mobile navigation remained fixed to the viewport after a real-browser CSS
containing-block regression was corrected. This check proves the built artifact and repository
subpath behavior; it does not substitute for the published HTTPS/LNA browser matrix below.

The isolated Chromium checks verified localized production UI and technical prose in Japanese,
Simplified Chinese, Arabic, and Bengali. The selector exposed all nine supported locales; changing
the locale updated `html.lang`, Arabic set `dir="rtl"`, and the 390×844 Arabic layout had no
horizontal overflow. A language change on the Connection route preserved the hash URL and Bridge
URL while persisting only the allowlisted locale value. The Docs check
confirmed that localized technical prose replaced the English source paragraph while the exact
TypeScript code block, commands, URLs, API names, and MCP identifiers still came from the canonical
English record. Simplified-Chinese search for `连接 认证` returned the corresponding stable source
sections through localized aliases.

The current production build was also exercised in a separate headed Chromium automation context
against the built loopback Bridge. The site submitted a credential-free request and displayed
`awaiting-approval`; the authenticated Bridge page displayed the exact observed
`http://127.0.0.1:4173` Origin plus self-declared app/runtime identity. An undecided request expired
with `APPROVAL_EXPIRED` and no session, then an explicit reconnect submitted a new request. Approve
established one browser session and registered 19 Tools, 23 Resources, and four Prompts. Both pages
had zero console errors. An official MCP SDK client then invoked the browser-hosted
`docs_get_section` Tool and received non-error, source-bearing Origin-approval content. The
temporary browser, Bridge, and site processes were closed after the check.

The full root integration test is a Node transport test, not a real-browser or published-Pages
check. It generates an isolated local CA and IP-valid loopback leaf
certificate, starts the same Bridge in HTTPS/WSS mode, connects the actual `BrowserMCP` web
library using a Pages-like exact HTTPS Origin, approves its waiting request through the authenticated
Bridge API, registers all real `/site` capabilities, connects
the official MCP client over trusted HTTPS, and invokes a Docs Tool, Resource, and Prompt. It
verifies 19 Tools, 23 Resources, four Prompts, source-bearing Docs output, and cleanup. The test CA
is supplied only to the test clients and the temporary files are removed; system trust is not
changed.

Other Bridge integration tests use real loopback HTTP, HTTPS, WebSocket, WSS, and the official MCP
client. They cover initialization and session handling, list-changed notifications, all three
primitive kinds, concurrent correlation, dynamic unregister, absence/disconnect, browser error
conversion, timeout, cancellation, strict Host/Origin, approval accept/reject/expiry and bounds,
legacy pairing expiry/replay, resume rotation and identity binding, malformed/oversized input,
MCP/admin authentication, CSRF, health CORS/LNA, and
TLS certificate verification. Cross-platform additions cover a real CLI process's one-line JSON
ready output and shutdown signal handling, Node/OpenSSL TLS generation safeguards, and the
single-file bundled Bridge startup/health path.

The Docs MCP suite separately evaluates all ten required development-support scenarios and an
in-memory BrowserMCP Protocol round trip. Search/retrieval tests consume the same structured corpus
as the visible docs.

## External and permission-dependent verification

### Published GitHub Pages and browser permission UI

- **Implementation status:** Implemented. The site has relative/static assets, hash routing,
  HTTPS-aware WSS defaults, exact Bridge URL validation, a credential-free LNA health probe,
  connection diagnostics, the Node WSS round trip described above, and a `main`-triggered GitHub
  Pages workflow. A remote workflow run and real-browser Pages MCP check remain unverified at this
  checkpoint.
- **Why it is not verified here:** This checkout has no Git remote and the installed `gh` CLI
  credential is invalid, so it cannot push or enable/observe Pages. A real top-level Pages MCP
  check also requires trusted loopback WSS and a Local Network Access decision in the selected
  browser context.
- **Required environment:** A public GitHub Pages repository URL or equivalent top-level HTTPS
  static host, the generated CA explicitly trusted in a disposable/current Safari, Chrome,
  Firefox, or Edge profile, the local TLS Bridge, and permission to access loopback.
- **Reproducible procedure:** Follow
  [`public-static-sites.md`](./public-static-sites.md): configure GitHub Pages to use GitHub Actions,
  push `main`, require the workflow to pass and obtain its deployment URL; generate and inspect the
  CA, trust it explicitly, start the TLS Bridge, open `#/connection`, run the local-access check, approve LNA
  if prompted, choose **Request approval**, verify the exact Origin in the authenticated Bridge
  page, choose **Approve**, and invoke `docs_get_section` through the common MCP endpoint. Repeat the
  request-and-approval flow in each target browser.
- **Expected result:** No certificate exception or mixed-content error; `/health` returns only
  `{ "status": "ok" }` with CORS for the eligible Origin; the site reports one active session and
  19/23/4 registrations; the MCP client receives a source-bearing browser-produced Docs result;
  Reject or expiry creates no session; disconnect removes all routes.

The following table is the browser-specific public-static-site verification record required by
[`specification.md`](./specification.md) and
[`public-static-sites.md`](./public-static-sites.md). None of these rows is implied by the Node WSS
integration or a static Vite build.

| Browser | Status | Unverified reason and required environment | Reproducible procedure | Expected result |
| --- | --- | --- | --- | --- |
| Safari | **NOT RUN** | Needs a published top-level HTTPS site, generated CA trusted through macOS Keychain, and a disposable/current Safari profile. Trust mutation was not requested. | Follow `public-static-sites.md`; open `#/connection`; verify WSS (never HTTPS→WS), run `/health`, request approval, approve the exact Origin in Bridge, list 19/23/4, invoke `docs_get_section`, then disconnect. | No mixed-content/certificate error; one active session; source-bearing result returns; disconnect removes routes. |
| Chrome | **NOT RUN** | Needs current Chrome, a published HTTPS Origin, trusted CA, Chrome `loopback-network` permission, and macOS Local Network permission. | Run credential-free `/health` first (fetch-like requests are permission-gated from Chrome 142), approve prompts, request access, approve the exact Origin in Bridge, then connect WSS (WebSockets are permission-gated from Chrome 147) and invoke a Docs Tool. | Health exposes no data; permission precedes WSS; approval creates one session; rejection or expiry creates none. |
| Edge | **NOT RUN** | Needs current Edge/Chromium, published HTTPS Origin, trusted CA, browser `loopback-network`, and macOS Local Network permission. | Repeat the Chrome sequence in an isolated Edge profile and approve its exact Origin request. | Same WSS registration/invocation/rejection/cleanup results as Chrome; policy-managed denial is reported as an environment constraint. |
| Firefox | **NOT RUN** | Needs current Firefox, a published HTTPS Origin, OS/root-store trust enabled for the generated CA, and any Firefox/OS local-network decision. | Confirm CA trust without an exception, run `/health`, request access, approve the exact Origin in Bridge, invoke `docs_get_section`, and disconnect. | No TLS exception; registration and invocation succeed if local-network policy permits; disconnect removes routes. |

### Third-party native MCP client

- **Implementation status:** Implemented and verified with the official SDK client over both HTTP
  and trusted HTTPS.
- **Why it is not verified here:** MCP client configuration formats and local-CA behavior differ,
  and changing an installed client's configuration was not requested. The repository does not
  assume control of an external user's client.
- **Required environment:** A Streamable HTTP MCP client that accepts an endpoint, an
  `Authorization` header, and the chosen local CA policy.
- **Reproducible procedure:** Start the Bridge, copy the startup MCP endpoint and MCP bearer into
  one client entry as shown in the root README, connect the browser site, list tools, and invoke the
  exposed name ending in `__docs_search`. In TLS mode, configure system CA use or an explicit CA
  file rather than disabling verification.
- **Expected result:** One MCP session initializes, all connected-app primitives are listed, the
  call executes in the tab, and the response returns through the same session. Removing the MCP
  bearer produces HTTP 401.

### Linux, Windows, and Intel Mac

- **Implementation status:** The common TypeScript/Node Bridge lives in `bridge`, uses OS-neutral
  Node.js APIs and PEM TLS inputs, and exposes the same CLI/configuration/protocols on macOS, Linux,
  and Windows. The native menu-bar app is intentionally macOS-only.
- **Why it is not verified here:** The available execution host is Apple Silicon macOS. No Linux,
  Windows, or Intel Mac runner/hardware was available, so portability is implemented but not
  represented as a completed support test.
- **Required environment:** Current Linux and Windows hosts plus an Intel Mac, Node.js 24+, npm 11+,
  loopback listeners, a current browser/MCP client, and an OS-appropriate disposable CA trust setup
  for WSS. Intel native-app validation additionally needs macOS 14+ and current Xcode.
- **Reproducible procedure:** On each host, run `npm ci`, `npm run check`, and
  `npm run start:bridge`; request access from `http://127.0.0.1:4173`, approve that exact Origin in
  the authenticated Bridge page, and complete the HTTP/WS round trip.
  Generate or supply an IP-SAN PEM certificate, install only its CA through that OS/browser's trust
  mechanism, then repeat the HTTPS/WSS round trip in `public-static-sites.md`. On Intel Mac, also
  build and test `macOS/BrowserMCPApp.xcodeproj` with code signing disabled and exercise the manual
  app procedure below.
- **Expected result:** The same endpoints, JSON ready record, security rejection behavior, site
  registration, and MCP results occur on all three Bridge platforms. Native app behavior should
  match Apple Silicon on Intel. These remain expectations, not support claims, until results are
  recorded.

### Native macOS menu-bar app

- **Implementation status:** Implemented as a SwiftUI/AppKit `.app` under `macOS`, with a resident
  menu-bar status item, management window, child-process start/stop/restart, Node/Bridge selection,
  endpoint and explicit credential reveal/copy controls, pending exact-Origin approval with
  Approve/Reject actions, legacy token compatibility, runtime counts, status-page launch, logs, and
  errors. It uses the
  same `bridge` process; Node.js 24 is an external runtime. App Sandbox is disabled to permit
  external-process and operator-selected-file access.
- **Automated evidence:** The unsigned Debug app and native tests are built with Xcode as recorded
  in the automated quality table. Lifecycle/parser tests cover structured ready output, strict
  pending-approval records, malformed request rejection, and process state without persisting
  secrets. A non-UI smoke check launches the Bridge from the built app's resource and confirms the
  runtime handoff.
- **Manual GUI status:** **NOT RUN.** MenuBarExtra clicking, window interaction, clipboard writes,
  and opening the default browser require a dedicated interactive macOS desktop. This work did not
  take over the user's active desktop or mutate clipboard/browser state.
- **Manual environment:** Apple Silicon Mac running macOS 14+, Node.js 24+, a graphical login
  session, and the unsigned Debug app. No signing identity, Keychain mutation, or deployment is
  required.
- **Reproducible procedure:** Launch `BrowserMCP.app`; confirm the menu-bar item appears and opens
  the management window. Select/detect Node and the bundled or development Bridge, then Start,
  Restart, and Stop. Confirm state transitions, endpoints, explicit credential copying, status-page
  launch, logs, and an actionable error for an invalid executable. Request access from `/site`,
  verify the exact Origin plus self-declared app/runtime labels, exercise Reject, then request again
  and exercise Approve. Quit while running and confirm the child Bridge no longer listens on
  `127.0.0.1:8789`.
- **Expected result:** One supervised Bridge process exists at a time; menu/UI state follows it;
  secrets appear only in the current in-memory state and explicit copy action; restart rotates
  credentials; stop/quit terminates the listener; no MCP or routing logic is duplicated in Swift.

## Definition of Done audit

| Specification requirement | Status | Evidence |
| --- | --- | --- |
| Reusable BrowserMCP Web library | Met | `packages/web`, public types/README, passing unit suite, ESM build |
| Register Tools, Resources, Prompts | Met | Declarative APIs, handles, dynamic register/unregister tests |
| Bridge Protocol defined | Met | `packages/protocol` discriminated messages and negotiation |
| Bridge Protocol implemented | Met | Strict runtime parser used on both Bridge and Web boundaries |
| Bridge Protocol documented | Met | [`bridge-protocol.md`](./bridge-protocol.md) and package README |
| Common Bridge under `/bridge` | Met | Generic Node.js package in `bridge`; no OS UI or site business logic |
| Cross-platform CLI/config/ready output | Implemented; non-macOS runs not performed | OS-neutral Node implementation and CLI tests pass on Apple Silicon macOS; Linux/Windows/Intel procedure is above |
| Native `.app` and Xcode project under `/macOS` | Met | SwiftUI/AppKit project and unsigned Debug build |
| Menu-bar status item opens management UI | Implemented; GUI interaction NOT RUN | `MenuBarExtra` and AppKit-hosted SwiftUI window with native state/model tests; manual procedure above |
| Native app starts/stops/restarts Bridge | Met | Child-process lifecycle implementation and tests |
| Native app detects/selects Node and Bridge | Met | Node 24 validation, bundled single-file Bridge preference, development fallback, and file selection |
| Native app presents endpoints, pending approvals, credentials, logs, errors | Met | Strictly parsed pending exact-Origin records with Approve/Reject, in-memory ready model, and management window controls; secrets are not persisted |
| MCP Streamable HTTP works | Met | Official SDK endpoint/client tests over HTTP and HTTPS |
| Bidirectional browser connection works | Met locally | Node real WS/WSS integration plus isolated headed Chromium request/approval/session check; published HTTPS browser matrix remains environment-dependent |
| Dynamic web capability registration | Met | Registry notifications and dynamic unregister tests |
| MCP client can discover browser capabilities | Met | Lists 19/23/4 real site primitives in the full round trip |
| MCP client can invoke browser capabilities | Met | Site Docs Tool/Resource/Prompt invoked end to end |
| Results return to MCP client | Met | Structured Tool, Resource, Prompt, and error conversion assertions |
| Disconnect processing | Met | Atomic route removal and pending-call rejection tests |
| Error processing | Met | Safe conversion, correlation, redaction, and malformed-input tests |
| Timeout processing | Met | Broker and Web handler deadline/cancel tests |
| Cancellation processing | Met | MCP signal → Bridge cancel → browser `AbortSignal` tests |
| Multiple-application identity | Met | Observed Origin principal plus self-declared app/runtime/instance routing metadata and state/status views |
| Name-collision policy | Met | App+Origin namespace; duplicate tabs fail `AMBIGUOUS_TARGET` |
| Mandatory security requirements | Met | Loopback/Host/Origin/auth/TTL/limits/version/redaction/CSRF/TLS tests and [`security.md`](./security.md) |
| Vite landing page under `/site` | Met | Framework-free LP and production build |
| Documentation under `/site` | Met | 19 required typed documentation pages and hash router |
| `/site` major-language i18n | Met | Nine complete UI catalogs and 19-page/68-section technical-prose overlays, canonical English code/identifier boundary, browser-language resolution, explicit persisted selector, Arabic RTL, localized Docs aliases, unit/integration tests, and isolated-browser verification |
| Entire `/site` is BrowserMCP-enabled | Met | One lifetime controller registers every site capability |
| `/site` uses repository Web library | Met | Workspace dependency and `BrowserMCP` controller import |
| `/site` connects to repository Bridge | Met locally | Isolated headed Chromium submitted an approval request, received approval, registered 19/23/4, and served a Docs MCP invocation; published HTTPS run remains pending |
| Public HTTPS static app can use local MCP | Implemented; external verification pending | WSS/LNA policy and Node transport test exist; the published top-level browser run is pending |
| GitHub Pages subpath/HTTPS compatibility | Implemented; remote run pending | Relative assets/hash routes, explicit-base build, and least-privilege `main` deployment workflow exist; push/deployment is blocked by absent remote and invalid `gh` auth |
| Docs MCP is practically useful | Met | Structured corpus and 11 specialized Docs Tools |
| Docs MCP evaluation passes | Met | All ten required cases plus exact source/section assertions |
| Major unit tests exist | Met | Passing workspace unit suites |
| Major integration tests exist | Met | Passing Node integration suites across all protocol boundaries; browser-only rows are tracked separately |
| Canonical specification lives under `docs` | Met | [`specification.md`](./specification.md) defines the shared contract and routes scoped authority to the protocol, security, public-static-site, design, and verification documents |
| README and technical docs exist | Met | Root/package/site READMEs, architecture, protocol, security, ADRs, public-static guide, this record |
| Minimum system requirements documented | Met | Root, Bridge, macOS app, site README, and structured Getting Started docs |
| OS-specific Bridge setup documented | Met | macOS, Linux, and Windows CLI, OpenSSL, CA trust, and lifecycle differences are explicit |
| Verified-platform scope documented | Met | Apple Silicon macOS is the only verified host; Linux, Windows, and Intel Mac are marked unverified with procedures |
| Static analysis succeeds | Met | Strict TypeScript, Biome lint, and Node script syntax gates |
| Formatting succeeds | Met | Repository Biome format check |
| Tests succeed | Met | Repository automated suites pass; environment-dependent browser rows are not counted |
| Build succeeds | Met | Protocol, Web, Bridge, Site, unsigned native macOS app, and explicit Pages base build |
| Unimplemented work is explicit | Met | README/site Roadmap and constraint sections |
| Known constraints are explicit | Met | Root/package/site docs and environment-dependent section above |
| GitHub Pages deployment pipeline | Implemented; remote run pending | Pinned GitHub actions, full quality gate, Pages-provided base, artifact-only upload, least-privilege OIDC deploy job |
| No unauthorized publication or external Bridge | Met | Pages may publish only `site/dist`; no package/release, credential/private-key, signed app, cloud relay, or externally bound Bridge is published |

The migration from the initial development plan to the canonical documentation set did not remove
requirements. The public-static/GitHub Pages requirement remains normative in
[`specification.md`](./specification.md), [`security.md`](./security.md), and
[`public-static-sites.md`](./public-static-sites.md), with verification status recorded here. The
common Bridge moved from the platform-named directory to `bridge` and exposes a portable Node.js
CLI. A separate native macOS menu-bar app manages that same process without changing protocol
responsibility or duplicating state; this is documented in ADR-007. Only Apple Silicon macOS is
verified. Linux, Windows, and Intel Mac remain explicitly unverified.

# BrowserMCP specification

The `docs` directory is the canonical specification set for BrowserMCP. This document defines the
shared product contract and routes each detailed requirement to its authoritative document. The
repository README files are operational entry points; tests and [`verification.md`](./verification.md)
are evidence that the specification is implemented, not alternate sources of requirements.

## Normative document map

| Scope | Canonical document |
| --- | --- |
| Product responsibilities and required capabilities | This document |
| Components, dependency direction, and trust boundaries | [`architecture.md`](./architecture.md) |
| BrowserMCP Bridge Protocol wire contract | [`bridge-protocol.md`](./bridge-protocol.md) |
| Authentication, Origin policy, limits, redaction, and TLS | [`security.md`](./security.md) |
| Public HTTPS static hosting and GitHub Pages | [`public-static-sites.md`](./public-static-sites.md) |
| Design rationale and deliberate trade-offs | [`design-decisions.md`](./design-decisions.md) |
| Verified and environment-dependent completion evidence | [`verification.md`](./verification.md) |

If two documents overlap, the scope-specific document in the table governs that scope. A change to
public behavior is incomplete until the applicable canonical document, implementation, and tests
agree.

## Purpose

BrowserMCP lets a browser tab act as an MCP runtime. An MCP client connects to one local Bridge by
standard MCP Streamable HTTP. A separately authenticated BrowserMCP Bridge Protocol carries
capability registration and invocation between that Bridge and connected browser applications.
Handlers execute in the browser, beside the application's JavaScript state and Web APIs.

The system must support local development and publicly hosted HTTPS static applications, including
GitHub Pages repository subpaths, without requiring an application-specific backend. The Bridge
must remain generic and must not contain business logic for any particular web application.

## Components and responsibility boundaries

- `packages/protocol` owns versioned, runtime-validated BrowserMCP Bridge Protocol types. It does
  not depend on standard MCP.
- `packages/web` owns the framework-independent declarative browser API, connection lifecycle,
  registration state, timeout/cancellation propagation, and browser-side protocol validation.
- `bridge` owns loopback listeners, standard MCP termination, authentication, routing, limits,
  conversion, session state, and the authenticated local status surface. Its CLI and configuration
  are OS-neutral across macOS, Linux, and Windows.
- `macOS` owns only the native menu-bar lifecycle and management UI for the common Bridge process.
  It must not duplicate MCP conversion, routing, or web-application logic.
- `site` is one BrowserMCP-enabled Vite application containing the landing page, documentation,
  connection UI, and browser-owned demonstration/development capabilities.

Standard MCP terminates at the Bridge. The internal protocol must not tunnel raw MCP messages. An
application owns its schemas, semantic validation, data access, user-visible context, and handler
behavior. An MCP client owns user intent and its own approval policy.

## Web library contract

The public Web library must:

- register Tools, Resources, and Prompts through typed declarative APIs;
- return registration handles that expose readiness and dynamic unregistration;
- accept JSON Schema metadata and asynchronous browser handlers;
- support concurrent correlated calls, timeout, cancellation, disconnect, and bounded reconnect;
- expose safe state, execution, registration, and diagnostic snapshots;
- work with npm-style bundlers and directly hosted static ESM artifacts;
- preserve one application identity while distinguishing runtimes, tabs, and reconnects;
- reject insecure remote-page transport and malformed/untrusted protocol messages.

## Bridge Protocol contract

The Bridge Protocol must remain separate from standard MCP and follow the complete wire contract in
[`bridge-protocol.md`](./bridge-protocol.md). Version negotiation and required feature negotiation
must precede registration. Messages must use bounded, discriminated envelopes and unique request
identifiers. Unknown fields, malformed payloads, invalid state transitions, duplicate terminal
responses, unsupported versions, and oversized input must fail closed.

## Common Bridge and native macOS application

The common Bridge must bind only to IPv4 loopback, provide one MCP Streamable HTTP endpoint and one
browser WebSocket/WSS endpoint, dynamically expose connected application capabilities, and remove
them atomically on disconnect. It must route calls and return results/errors without interpreting
application business semantics.

The CLI must provide OS-neutral flags/configuration and one structured ready record containing the
runtime endpoints and startup-scoped credentials. The Bridge targets current macOS, Linux, and
Windows with external Node.js 24 or newer.

The native macOS application must be a buildable SwiftUI/AppKit `.app` and Xcode project under
`macOS`. It must provide a menu-bar status item and management UI for start, stop, restart,
Node/Bridge selection, endpoints, explicit credential reveal/copy, pending exact-Origin approval, runtime
counts, logs, and actionable errors. Secrets and process state remain in memory. The app is
macOS-only; cross-platform support belongs to the common Bridge.

## Identity, namespaces, and routing

The observed browser Origin is the authenticated web principal. App ID, name, version, runtime ID,
and instance ID are self-declared routing metadata. Bridge-visible capability names must include an
application namespace. Different applications may reuse a local name. Multiple matching providers
for the same app and Origin are ambiguous and must be rejected rather than silently selecting the
last writer or rerouting after failure.

## Security requirements

All requirements in [`security.md`](./security.md) are mandatory. At minimum:

- bind only to `127.0.0.1` and validate the HTTP Host;
- require an explicit operator decision for the exact observed Origin before a new browser
  connection receives a session or may register capabilities;
- bound, expire, deduplicate, and expose pending approval requests only through the authenticated
  same-origin/CSRF-protected administration surface;
- retain cryptographically random, short-lived, one-time Origin-bound pairing tokens only as a
  documented compatibility path and reject replay;
- authenticate MCP, admin, and browser surfaces with distinct startup/session credentials;
- keep credentials out of URLs and persistent site storage;
- validate all untrusted JSON at runtime and enforce message, request, registration, concurrency,
  deadline, idle-session, and history limits;
- propagate timeout and cancellation and clean up atomically on disconnect;
- redact known credential fields, bearer values, token patterns, and credential-bearing URLs, and
  never log handler result bodies;
- use same-origin CSRF protection for local administrative mutations;
- support operator-supplied HTTPS/WSS certificates without disabling verification or modifying an
  OS trust store automatically.

Loopback is an exposure boundary, not authentication. Pairing one GitHub Pages Origin grants the
authority of all content sharing that Origin, not one repository path.

## Site contract

The complete `site` must use the repository Web library and connect to the common Bridge as one
long-lived BrowserMCP application. Hash routing and relative or explicit Vite base paths must allow
static deployment below a GitHub Pages repository path without server rewrites.

The site must include:

- a technical landing page and minimal application example;
- structured, searchable documentation covering concepts, architecture, setup, Tools, Resources,
  Prompts, results/errors, lifecycle, protocol, security, multiple apps, APIs, Bridge configuration,
  troubleshooting, development, and roadmap;
- a connection UI with secure URL validation, credential-free local-access diagnostics, browser
  approval requests with no token input, connection/session state, registrations, recent safe
  execution history, and disconnect/reconnect actions;
- browser-owned Docs, page/runtime/status, Origin-scoped IndexedDB, and bounded Worker capabilities.

### Internationalization

The site must support English, Japanese, Simplified Chinese, Spanish, Hindi, Arabic, Brazilian
Portuguese, Bengali, and Russian. It must safely resolve browser preferences, provide an explicit
selector, persist only an allowlisted non-secret locale, and apply RTL document/layout direction for
Arabic. Locale changes must not alter the hash route, stable Docs identifiers, Origin, connection
input drafts, or BrowserMCP session.

Human-facing technical prose must be available in each display language through stable page/section
overlays. Code, commands, URLs, API names, protocol/MCP identifiers, source paths, and
machine-readable Docs MCP responses remain tied to the canonical English corpus.

## Docs MCP quality contract

Docs MCP must use the same typed corpus and stable identifiers as the visible documentation; it
must never scrape the rendered DOM. It must provide source-bearing operations for cross-document
search, exact page/section retrieval, API/type search, examples, troubleshooting, implementation
guides, responsibility boundaries, capability status, and related documents. Resources must expose
the index, pages, status inventory, current page, and live site state. Prompts must guide setup,
implementation, diagnosis, and architecture review while directing clients back to structured Docs
operations and exact sources.

Evaluation must cover concept search, exact API lookup, type lookup, examples, configuration,
error/lifecycle guidance, troubleshooting, implementation planning, responsibility decisions,
status distinctions, related-document navigation, not-found behavior, and source/page/section
traceability.

## Public static application contract

Public HTTPS pages must connect to a browser-trusted loopback WSS endpoint and receive explicit
operator approval for the exact observed Origin. The implementation must account for secure-context,
mixed-content, certificate trust, and Local Network Access policy. The site must provide a
credential-free health probe before requesting approval.
The reproducible setup and browser matrix are normative in
[`public-static-sites.md`](./public-static-sites.md). A push to `main` must run the full repository
quality gate before a least-privilege GitHub Pages job deploys only the generated `site/dist`
artifact with the Pages-provided base path.

## Minimum requirements and verified scope

- Common Bridge: Node.js 24+, npm 11+, current macOS/Linux/Windows target, IPv4 loopback.
- Native app: macOS 14+, external Node.js 24+, current Xcode.
- Browser: current stable Safari, Chrome/Chromium, Firefox, or Edge.
- MCP client: Streamable HTTP and custom Authorization header support.
- Public HTTPS site: trusted loopback certificate and permission for applicable browser/OS local
  network policy.

Only Apple Silicon macOS is a verified host in the current evidence. Linux, Windows, and Intel Mac
are implementation targets but remain unverified until their procedures in
[`verification.md`](./verification.md) are executed and recorded.

## Quality and completion contract

Every change must keep code, tests, README guidance, structured site documentation, and canonical
documents synchronized. The repository quality gates are formatting, static analysis, strict type
checking, unit tests, integration tests, and production builds. Security-sensitive behavior must
have negative-path tests. Public static behavior must include an explicit Pages-subpath build and
either real-browser evidence or a reproducible environment-dependent procedure with expected
results.

Completion requires the reusable Web library, validated Bridge Protocol, common cross-platform
Bridge, native macOS management app, fully BrowserMCP-enabled site, practical Docs MCP, security
controls, tests, builds, and durable documentation described above. Environment-dependent items and
known constraints must be explicit in [`verification.md`](./verification.md).

## Out of scope

Repository work does not publish npm packages or releases, expose the local Bridge as an external
service, deploy credentials/private keys, change persistent system/browser trust automatically,
disable TLS verification, sign or notarize the native app, ship an installer or auto-updater,
bundle Node.js, implement a cloud relay, or execute arbitrary code through demonstration
capabilities. GitHub Pages deployment is limited to the public static `site/dist` artifact produced
after the required quality gates pass on `main`.

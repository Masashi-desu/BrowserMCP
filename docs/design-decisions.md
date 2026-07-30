# Design decisions

This log records rationale for choices made under the canonical specification set rooted at
[`specification.md`](./specification.md). It is updated when implementation constraints change.

## ADR-001: npm workspace plus a separate native app boundary

**Decision:** Use npm workspaces for the protocol, web library, cross-platform Bridge, and site;
keep the native macOS app as a separate Xcode project.

**Reason:** npm ships with the required Node.js LTS, workspace links preserve package boundaries,
and one lockfile makes JavaScript builds reproducible without introducing another package manager.
The SwiftUI/AppKit shell belongs to Xcode and does not pull native lifecycle concerns into the
cross-platform Node.js core.

## ADR-002: TypeScript and ESM throughout

**Decision:** Use strict TypeScript and standards-based ES modules.

**Reason:** The browser library must work with bundlers and static ESM, while the bridge needs
reliable discriminated protocol types. Shared language and module semantics reduce conversion code.

## ADR-003: Separate standard MCP from BrowserMCP Bridge Protocol

**Decision:** Standard MCP terminates at the bridge. Browser connections exchange only the
versioned BrowserMCP Bridge Protocol.

**Reason:** Forwarding opaque MCP messages would leak transport and SDK concerns into web apps and
make the trust boundary difficult to validate. The internal protocol carries application/runtime
identity, origin, registration, cancellation, and reconnection semantics that standard MCP does
not model for this use case.

## ADR-004: Official MCP SDK v2 at the transport boundary

**Decision:** Use the web-standard Fetch handler from `@modelcontextprotocol/server` for modern
`2026-07-28` Streamable HTTP serving and MCP message schemas, only in the bridge. Adapt its
`Request`/`Response` face directly to the existing Node HTTP server, and use
`@modelcontextprotocol/client` in transport integration tests.

**Reason:** Per-request envelopes, stateless serving, `subscriptions/listen`, cancellation, cache
hints, and result projection should track the standard. The product is unreleased, so rejecting the
legacy `initialize` and session lifecycle keeps one implementation path. Keeping the dependency out
of browser packages prevents standard-MCP types from becoming the internal protocol by accident.

## ADR-005: WebSocket for the browser transport

**Decision:** Use a WebSocket endpoint on the bridge's loopback HTTP server.

**Reason:** Browser-native bidirectional messaging supports dynamic registration, invocation,
cancellation, ping/pong, and reconnection without polling. A strict Origin gate and application
handshake are mandatory because WebSocket connectivity alone grants no authority.

## ADR-006: Three independent credential scopes

**Decision:** Use separate authority for MCP access, browser approval/pairing/resume, and status
administration.

**Reason:** Every local process and web origin must be treated as untrusted. Splitting credentials
prevents an MCP client from registering a fake runtime, a paired page from reading bridge-wide
status, or a status viewer from invoking browser capabilities. Credentials are generated from a
cryptographic RNG, redacted from logs, bounded in lifetime, and kept in memory.

## ADR-007: Cross-platform Node.js core plus a native macOS menu-bar shell

**Decision:** Keep the authoritative Bridge in the root `bridge` package and support current
macOS, Linux, and Windows through one Node.js 24 CLI. Add a native SwiftUI/AppKit app under `macOS`
that launches and supervises that same process rather than reimplementing it.

**Reason:** Protocol conversion, authentication, routing, limits, and status must have one source
of truth and remain portable. A thin `MenuBarExtra`/Window shell supplies the persistent macOS
experience—lifecycle controls, endpoints, credential copy, status-page access, and logs—without
forking the security boundary or adding application-specific logic to the Bridge.

**Impact:** The app consumes a dependency-bundled single-file Bridge module or the repository CLI
fallback and requires an external Node.js 24 runtime. It persists non-secret launch preferences,
but credentials and process state remain memory-only. The app is available as an unsigned local
development build; signing, notarization, packaging, auto-update, and bundled Node.js are out of
scope. App Sandbox is disabled because the shell must launch external Node and use
operator-selected executables/TLS files; those selections are part of the local trust boundary.
Only Apple Silicon macOS has been verified; Linux, Windows, and Intel Mac are not yet
verified support claims.

## ADR-008: Framework-independent web library and site

**Decision:** Use browser APIs and TypeScript without a UI framework.

**Reason:** The public library must be framework-neutral, and the site does not require framework
runtime complexity. This keeps the static output small and makes Worker, IndexedDB, and connection
lifecycle behavior visible.

## ADR-009: Structured documentation as the source of truth

**Decision:** Store documentation as structured records consumed by both the site renderer and
Docs MCP handlers.

**Reason:** DOM scraping loses stable IDs, status, relationships, and source metadata. Structured
records enable deterministic cross-document search and tests for development-agent use cases.

## ADR-010: Volatile subscriptions, browser sessions, and registrations

**Decision:** Do not persist bridge credentials, MCP notification subscriptions, active browser/UI
sessions, or capability registrations.

**Reason:** A restart becomes an explicit revocation boundary and avoids leaving reusable secrets
on disk. Browser applications reconnect and publish a fresh complete capability snapshot.

## ADR-011: Trusted loopback WSS for public HTTPS static apps

**Decision:** Keep HTTP/`ws` for local HTTP development and add certificate-configured HTTPS/`wss`
for GitHub Pages and other public HTTPS static apps. Generate local development certificate
material only on operator request and never install trust automatically.

**Reason:** Public HTTPS pages cannot portably rely on an insecure WebSocket; current Safari
behavior makes WSS necessary for a cross-browser path. A local certificate lets the bridge remain
loopback-only without a cloud relay. Exact Origin approval, pairing, MCP authentication, and Local
Network Access permission remain mandatory, so TLS does not replace authorization.

**Impact:** Published-site use has an explicit one-time local certificate trust step. The generated
private keys must never be deployed with the static site. The site uses relative Vite assets and
hash routes so repository subpaths do not require server rewrites.

## ADR-012: A structured ready record for process supervision

**Decision:** Preserve the human-readable Bridge startup output and add `--json`, which writes one
machine-readable ready record to standard output while operational logs remain on standard error.

**Reason:** The macOS app and future platform lifecycle shells must not scrape prose or infer
credentials and endpoints from partial log lines. A bounded JSON record provides an explicit
handoff while keeping the standalone CLI usable.

**Impact:** The record contains startup-scoped secrets and must be handled like the existing
terminal output: keep it in process memory, never log it, and revoke it by stopping the Bridge.
This interface does not make the native app an authority for Bridge runtime state.

## ADR-013: Browser-initiated, operator-approved Origin pairing

**Decision:** The default web flow sends a credential-free `approval` connect request and waits on
that socket while the operator approves or rejects the exact observed Origin in the authenticated
Bridge management page. Legacy one-time tokens remain an explicit compatibility path.

**Reason:** A token field on every static application duplicates operator ceremony, invites secret
copy/paste mistakes, and falsely makes the public page look like the credential authority. The
Bridge already owns local administration and can correlate a bounded pending socket with the exact
browser-controlled Origin. Keeping the decision there makes the trust boundary visible without
placing app-specific logic in the Bridge.

**Impact:** An arbitrary eligible HTTPS site can reach the data-free health endpoint and allocate a
strictly bounded, expiring pending request. It receives no session, registration, state, or secret
before approval. The Bridge caps global and per-Origin pending requests, rejects a duplicate
app/runtime/instance tuple, requires authenticated same-origin/CSRF-protected decisions, and closes
rejected or expired sockets. This deliberate minimal pre-authentication exposure is the cost of
first-time approval from a public static page.

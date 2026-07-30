# Architecture

BrowserMCP uses a browser tab as an MCP execution runtime. The local bridge translates
standard MCP requests into a separate, purpose-built browser protocol; application handlers
remain in the browser.

```text
MCP client
  | Streamable HTTP + per-process bearer credential
  v
Cross-platform Node.js BrowserMCP Bridge (127.0.0.1 only) <--- optional macOS BrowserMCP.app
  | BrowserMCP Bridge Protocol over authenticated WebSocket
  v
BrowserMCP web application
  | BrowserMCP declarative API
  +-- tools / resources / prompts
  +-- Worker / WASM / IndexedDB / browser APIs
```

## Package boundaries

| Location | Responsibility | Deliberately does not contain |
| --- | --- | --- |
| `packages/protocol` | Versioned browser/bridge messages, public data types, runtime validation | MCP SDK types, transport code, application handlers |
| `packages/web` | Framework-independent API, handler registry, lifecycle, reconnection, invocation execution | Standard MCP conversion, site-specific behavior |
| `bridge` | Cross-platform loopback service, MCP/WebSocket transports, authentication, routing, limits, status UI | OS-specific UI and business logic for a particular web app |
| `macOS` | Native menu-bar lifecycle/UI shell for the shared Bridge process | MCP conversion, browser protocol state, app-specific capabilities |
| `site` | Vite site, structured documentation, documentation MCP capabilities, browser API examples | Bridge internals or alternate protocol definitions |
| `tests/integration` | Cross-boundary MCP-to-browser round trips | Product implementation |

Dependencies point inward: the web library and bridge depend on the protocol; the site depends
on the web library. The bridge never depends on the site. Only the bridge imports the standard
MCP SDK. The macOS app launches the Bridge executable and consumes its structured ready output;
it does not become another protocol implementation.

The loopback server has two operating modes. Local HTTP development uses HTTP/`ws`; an HTTPS static
site uses the same service with an operator-supplied locally trusted certificate, producing
HTTPS/`wss`. The browser library probes the data-free `/health` endpoint to surface Local Network
Access permission or trust failures before the authenticated WebSocket handshake. See
[Public static sites](./public-static-sites.md).

## Runtime model

A browser connection presents an application, runtime, and tab/instance tuple and has an observed
Origin. Only the Origin is a browser security principal; the other fields are self-declared routing
metadata. A first connection remains pending until the operator approves the exact observed Origin
in the authenticated Bridge management page. The resulting resume credential is then bound to that
Origin plus the declared tuple. A successful approval and handshake creates a bridge session.
The browser then replaces or incrementally updates its
registered capability snapshot. The bridge owns only metadata and routing information; handlers
and application state stay in the tab.

An Origin is scheme, host, and port—not a path. Consequently, GitHub Pages project sites under one
`OWNER.github.io` host share a principal even when repository paths differ. A dedicated custom
hostname is the trust-separation mechanism; `app.id`, `runtimeId`, and `instanceId` do not replace
same-Origin isolation.

MCP request processing is stateless and independent from a browser session. Each `2026-07-28`
request carries its own protocol/client envelope, receives a fresh MCP server instance, resolves an
unambiguous namespaced capability, creates a bounded pending request, and forwards it to the owning
browser session. Results and safe error data are converted back to standard MCP responses.
`subscriptions/listen` SSE streams are the sole durable MCP transport state and attach to a shared,
bounded event bus. Disconnecting a browser atomically removes its routes, rejects its pending
requests, and publishes coalesced list-changed events to matching subscriptions.

The initial implementation keeps runtime state in memory. This is intentional: credentials,
sessions, pending calls, and registered capabilities cannot survive a bridge restart, so restart
also revokes authority.

## Platform form factors

The authoritative Bridge is a Node.js 24 process in `bridge`. Its CLI, configuration, PEM TLS
inputs, loopback endpoints, internal protocol, and standard MCP behavior are OS-independent and
target current macOS, Linux, and Windows. It does not install an OS service or mutate a trust
store. The only completed real-host verification is Apple Silicon macOS; Linux, Windows, and Intel
Mac remain explicitly unverified.

On every platform, the Bridge serves a small authenticated management page from the same loopback
process. It reports authoritative runtime state, shows bounded pending Origin requests, and accepts
an explicit Approve or Reject decision. It can also issue an Origin-bound one-time pairing token as
a legacy compatibility path; it does not execute browser capabilities.

`macOS/BrowserMCPApp.xcodeproj` adds a native SwiftUI/AppKit shell for macOS 14+. `MenuBarExtra`
keeps a status item resident, and an AppKit-hosted SwiftUI management window provides
start/stop/restart controls, executable selection, endpoints, explicit credential reveal/copy,
pending exact-Origin approval with Approve/Reject actions, legacy token compatibility, runtime
counts, status-page launch, logs, and lifecycle errors.
The app starts the same Bridge as a child process and consumes its single-line JSON ready record.
It prefers the dependency-bundled `browsermcp-bridge.mjs` app resource and falls back to
`bridge/dist/cli.js` for repository development. Node.js 24 itself is external. Secrets and live
process state stay in memory; only non-secret launch preferences are persisted. The app is built
unsigned for local development and is not notarized, distributed, or auto-updated. Its App Sandbox
is disabled because it launches an external Node runtime and accepts operator-selected files; this
is documented as an explicit local trust constraint rather than hidden behind the native shell.

## Site and documentation

The Vite site creates one `BrowserMCP` instance for its complete lifetime. Route changes update
page-aware data without creating a second application session. Landing, docs, and status views
therefore present one coherent capability set.

The site i18n layer is a static, typed module rather than a runtime translation service. It resolves
an allowlisted BCP 47 display locale from browser preferences or one non-secret local preference,
then rerenders the same route and controller state. Locale changes do not reconnect the Bridge,
change an Origin, alter hash-route/document identifiers, or persist form credentials. Arabic sets
the document direction to RTL. The current locale and direction are included in page/runtime MCP
snapshots. The English structured technical corpus remains the traceable source; localized UI and
technical prose are presentation overlays over stable page/section IDs. Code examples, commands,
URLs, API/MCP identifiers, and machine-readable Docs MCP responses are never copied into the
translation catalogs and therefore remain byte-for-byte tied to the canonical English records.

Documentation pages are structured TypeScript data, not scraped DOM. The visual docs renderer and
the documentation MCP search/retrieval handlers consume the same records and identifiers. Search
results preserve page, section, source path, implementation status, related topics, examples, and
constraints so an implementation agent can follow the evidence.

## Failure and concurrency model

- Protocol inputs are validated before state changes.
- Payload size, concurrent calls, and call duration are bounded at transport and request layers.
- Each forwarded request has one owner and one terminal state: result, error, cancellation,
  timeout, or disconnect.
- Explicit MCP cancellation propagates to the browser. Browser handlers receive an `AbortSignal`.
- Reconnection is authenticated and replaces stale routing state with a full capability snapshot.
- Capability-list changes generate MCP list-changed notifications when supported by the client.

See [Bridge Protocol](./bridge-protocol.md), [Security](./security.md), and
[Design decisions](./design-decisions.md) for normative details.

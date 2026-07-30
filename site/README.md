# `@browsermcp/site`

Framework-free Vite landing page, documentation application, and BrowserMCP runtime for this repository.
The complete site is one `BrowserMCP` app. Visible documentation and Docs MCP responses are generated from
the same typed corpus in `src/docs/content.ts`; MCP search never scrapes the DOM.
The corpus records source provenance against the canonical specification set rooted at
[`docs/specification.md`](../docs/specification.md).

## Internationalization

The framework-free UI includes a typed, dependency-free i18n layer for nine display locales:
English, Japanese, Simplified Chinese, Spanish, Hindi, Arabic, Brazilian Portuguese, Bengali, and
Russian. On first load it resolves `navigator.languages`
to an allowlisted locale; the header selector then lets the user override it. The selection is the
only value written to `localStorage` (`browsermcp.site.locale.v1`). Storage denial is non-fatal,
unknown values fall back safely, and pairing/MCP/admin credentials never enter this setting.

Changing language updates `html[lang]`, text direction, localized number/time formatting, the
document title, navigation, landing page, Connection controls, Docs chrome, and documentation page
titles without changing the hash URL, stable page/section IDs, input drafts, or BrowserMCP session.
Arabic uses `dir="rtl"` with logical-direction layout overrides. Every locale has translated page
descriptions, section headings, and technical prose keyed by stable page/section IDs. Code blocks,
commands, URLs, API names, protocol/MCP identifiers, and machine-readable Docs MCP responses keep
the canonical English corpus so translation cannot change executable meaning. Search accepts
common setup, connection, authentication, security, and capability terms in every supported
language and maps them into the same source-backed index.

Every advertised locale has every UI message key and all 19 page/68 section translation keys; the
unit suite fails on either kind of fallback. Translation catalogs contain prose only, so executable
code and stable identifiers continue to come directly from the canonical English records without
adding explanatory UI to each article.

The current display locale and direction are exposed by `site_current_page`, `site_structure`, and
`site_runtime`. To add a locale, extend the allowlist, native label/direction, message overrides,
documentation title catalog, search aliases, and the i18n unit matrix together. No locale is put in
the URL, so GitHub Pages routes and exact-Origin approval remain unchanged.

## Routes

Routing uses URL hashes so the static build works on a GitHub Pages repository subpath without rewrite rules.

- `#/` — technical OSS landing page and minimal app example
- `#/docs` — documentation index and structured search
- `#/docs/:pageId#sectionId` — one of the 19 required documentation areas
- `#/connection` — Bridge URL, TLS/LNA/Origin diagnostics, pairing, session, registrations, history, result, errors, logs, reconnect, and disconnect

## Implementation structure

- `src/docs/content.ts` — 19 typed pages, sections, examples, source identifiers, related references, and implementation status
- `src/docs/engine.ts` — normalized index, ranked cross-page search, exact lookup, API/type/example lookup, guides, diagnosis, responsibility, capability status, and related documents
- `src/browsermcp/capabilities.ts` — browser-executed Tools, Resources, and Prompts
- `src/browsermcp/registration.ts` — the single adapter to `@browsermcp/web`
- `src/browsermcp/controller.ts` — one site runtime, safe UI snapshot, connect/disconnect/reconnect, and LNA health preparation
- `src/runtime/` — protocol-aware Bridge URL policy, bounded IndexedDB JSON demo, cancellable Web Worker analysis, and static base handling
- `src/i18n/` — locale resolution, safe preference persistence, UI and technical-prose overlays, canonical-code boundaries, and RTL metadata
- `src/ui/` — accessible framework-free DOM rendering and hash routing

## Docs MCP

The site registers 19 Tools:

- `docs_search`, `docs_get_page`, `docs_get_section`
- `docs_search_api`, `docs_search_types`, `docs_find_examples`
- `docs_troubleshoot`, `docs_implementation_guide`, `docs_responsibility`
- `docs_capabilities`, `docs_related`
- `site_current_page`, `site_structure`, `site_navigation`, `site_runtime`, `site_status`
- `site_storage_put`, `site_storage_get`, `site_worker_analyze`

It also registers 23 Resources: the corpus index, status inventory, live page/status snapshots, and one resource
for each documentation page. Four Prompts cover setup, implementation, diagnosis, and responsibility review.
Every Docs search result includes page and section IDs, a logical path, a base-independent `#/docs/...` href,
implementation status, source identifier, related pages, and relevant examples when present.

`site_storage_put` is deliberately narrow. It stores canonical JSON only, limits size/depth/item count,
rejects secret-like keys and strings at every level, rejects prototype-mutating keys, and uses only this
Origin's IndexedDB. Both storage Tools are annotated as potentially destructive: put may overwrite/evict,
and get removes a tampered record before rejecting, so repeated reads can differ. `site_worker_analyze`
accepts bounded text and never evaluates code.

## Local development

Requirements are Node.js 24+, npm workspaces, a current browser, and the cross-platform local Bridge. The same
Bridge CLI targets macOS, Linux, and Windows; only Apple Silicon macOS has been verified. From the repository root:

```sh
npm install
npm run build:libs
npm run dev:site
```

For a local HTTP Vite Origin, the default browser endpoint is
`ws://127.0.0.1:8789/browser`. Start the Bridge:

```sh
npm run start:bridge -- --port 8789
```

In `#/connection`, choose **Request approval**, then authenticate to the Bridge management page,
verify the exact Origin/app identity, and approve the waiting request. The site has no token input;
it receives no approval credential and persists no authentication state.

The MCP client uses one Streamable HTTP entry at `http://127.0.0.1:8789/mcp` and must send
`Authorization: Bearer <MCP token printed at this Bridge startup>`. Browser pairing, MCP bearer, and admin
tokens are separate credentials. The client must pin MCP revision `2026-07-28`; this endpoint is
stateless and POST-only, with no `initialize`, `Mcp-Session-Id`, `GET`, or `DELETE` compatibility
path.

On macOS 14+, the native `BrowserMCP.app` is an alternative lifecycle UI for this exact Bridge. Its menu-bar
item opens a management window that can start/stop/restart the process and show/copy its endpoints and startup
credentials. It does not change the site's protocol or connection settings and still requires external Node.js 24+.

## GitHub Pages static build and deployment

To produce output for an HTTPS repository subpath locally:

```sh
VITE_BASE_PATH=/BrowserMCP/ npm run build:site
```

On Windows PowerShell, set `$env:VITE_BASE_PATH = "/BrowserMCP/"`, run `npm run build:site`, then
use `Remove-Item Env:VITE_BASE_PATH` so the override does not leak into later commands.

The default relative base (`./`) also supports subpath hosting. An HTTPS page defaults to
`wss://127.0.0.1:8789/browser`; HTTPS-to-`ws://` is rejected. Non-loopback HTTP site Origins are rejected for
both `ws:` and `wss:` because an on-path attacker could modify the page or pairing flow. Plain HTTP is
supported only for local `localhost`/`127.0.0.1` development. Prepare a trusted local certificate and start
TLS mode before using a static HTTPS page:

```sh
npm run tls:generate -- .browsermcp/tls
npm run start:bridge -- --port 8789 \
  --tls-cert .browsermcp/tls/localhost-cert.pem \
  --tls-key .browsermcp/tls/localhost-key.pem
```

Inspect and explicitly trust only `.browsermcp/tls/ca-cert.pem` through the active OS/browser trust mechanism;
never import the private keys or bypass certificate warnings. The Node helper invokes OpenSSL without a shell and
uses native paths on macOS, Linux, and Windows. See `docs/public-static-sites.md` for macOS Keychain, Linux
distribution/browser, and Windows current-user trust steps. A Pages repository path is not part of Origin: approve
the exact scheme, host, and optional port only. Use
**Check local access** before connecting; it performs a credential-free `/health` request that can surface
certificate and Local Network Access issues. Chrome 142 gates fetch-like local requests and Chrome 147 extends
LNA to WebSockets; allow `loopback-network` and any OS local-network permission if prompted. This is current LNA
permission, not legacy PNA preflight. Safari rejects HTTPS-to-insecure-WebSocket mixed content.

Every `https://owner.github.io/<repo>/` project shares the Origin `https://owner.github.io`. Approval cannot be
limited to `/BrowserMCP/`; trust all content on that Origin or use a dedicated custom hostname/Origin.

`VITE_BRIDGE_URL` may override the initial editable URL, but it must remain a loopback `ws(s)` URL with the
exact `/browser` path and no credentials, query, or fragment.

The pinned `.github/workflows/pages.yml` workflow runs `npm ci` and the complete `npm run check`
gate for pushes to `main`, reads GitHub Pages' configured `base_path`, rebuilds with that exact
`VITE_BASE_PATH`, uploads only `site/dist`, and deploys from a separate least-privilege OIDC job.
Configure the repository's Pages source as **GitHub Actions**. The workflow contains no Bridge,
MCP, TLS, or approval credential.

The repository site is published at
[`https://masashi-desu.github.io/BrowserMCP/`](https://masashi-desu.github.io/BrowserMCP/).
[Deployment run 29643866925](https://github.com/Masashi-desu/BrowserMCP/actions/runs/29643866925)
passed the complete gate and deployment.

## Quality commands

```sh
npm run build:libs
npm run typecheck -w @browsermcp/site
npm run test:unit -w @browsermcp/site
npm run test:integration -w @browsermcp/site
npm test -w @browsermcp/site
npm run build -w @browsermcp/site
npx biome check site
```

The integration suite includes the ten Docs MCP evaluation cases and an actual
`BrowserMCP → BrowserMCP Bridge Protocol → Docs handler → validated result` round trip using an in-memory
Bridge transport.

## Manual real-environment verification

The Pages workflow cannot configure local certificate trust or browser permissions. To verify the
real TLS/browser/Bridge path after deployment:

1. Prerequisites: a target macOS, Linux, or Windows host, Node.js 24+, trusted generated local CA, built Bridge
   and site, and an MCP Streamable HTTP client. The only repository verification environment is Apple Silicon
   macOS 26.5.2 with Node.js 24.10.0 and Xcode 26.6; Linux, Windows, and Intel Mac are not verified.
2. Start the TLS Bridge and keep its startup credentials private.
3. Serve `site/dist` from an HTTPS repository subpath or equivalent local HTTPS static host.
4. Open `#/connection`, confirm the default is `wss://127.0.0.1:8789/browser`, and run **Check local access**.
5. Grant LNA if prompted, choose **Request approval**, then approve the exact Origin and app identity
   in the authenticated Bridge management page.
6. Expect an active session, 19 Tools, 23 Resources, four Prompts, no secret-bearing logs, and a successful
   `docs_search` invocation in recent history.
7. Configure the MCP client with the startup MCP bearer, list capabilities, and call `docs_get_section` for
   `tools/register-tool`. Expect a browser-produced result containing the exact source page and section.
8. Disconnect. Expect the site runtime capabilities to disappear from the Bridge without affecting another app.

The published Pages site completed this flow in an isolated installed-Chrome context: after a
context-scoped Local Network Access grant, it reached the TLS loopback Bridge, requested and
received exact-Origin approval, registered 19/23/4, and served `docs_get_section` to an official
MCP SDK client. The disposable context ignored loopback TLS errors, so OS trust installation and
interactive permission UI remain unverified; Safari, Edge, and Firefox are also **NOT RUN**.
The per-browser scope, required environment, reproducible steps, and expected result are recorded
in [`docs/verification.md`](../docs/verification.md).

## Known constraints

- The verified host is Apple Silicon macOS; Linux, Windows, and Intel Mac behavior is unverified.
- The optional native menu-bar app is macOS-only, unsigned, requires external Node.js 24+, and disables App
  Sandbox to launch operator-selected executables/files; it is not a Linux/Windows UI or a replacement Bridge
  implementation.
- Browser handlers remain subject to same-origin policy, secure contexts, permission prompts, user gestures,
  tab lifetime, and browser resource limits.
- Multiple matching tabs are rejected as ambiguous; version 0.1 has no per-call target selection, so close
  duplicate providers and retry. There is no silent last-writer fallback.
- `.github/workflows/pages.yml` publishes only the generated static site after `npm run check` on
  `main`. npm/release publication, signing, notarization, cloud relay, and external Bridge hosting
  are not part of this work.

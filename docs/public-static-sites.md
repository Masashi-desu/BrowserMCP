# Public HTTPS static sites and GitHub Pages

BrowserMCP web apps do not need an application backend. A bundled app on an HTTPS static host can
connect directly to the user's loopback bridge. The connection still needs explicit local setup:
trusted WSS, an operator decision for the exact Origin, and any browser Local Network Access
permission. The static page does not need a token input or application backend.

This repository deploys the documentation site through a least-privilege GitHub Pages workflow on
`main`. The same Web library and WSS requirements apply to every HTTPS static host; the Pages
workflow is only this repository's hosting automation, not a BrowserMCP protocol dependency.

The repository deployment is live at
[`https://masashi-desu.github.io/BrowserMCP/`](https://masashi-desu.github.io/BrowserMCP/).
An isolated installed-Chrome verification completed the credential-free health probe, context-scoped
Local Network Access grant, exact-Origin approval, WSS registration of 19/23/4 capabilities, and an
official MCP SDK invocation of the browser-hosted `docs_get_section` Tool. The disposable context
ignored loopback TLS errors instead of changing the OS trust store, so manual CA import and the
interactive browser/OS permission UI remain separate operational checks. The complete evidence and
browser matrix are recorded in [`verification.md`](./verification.md).

## Why WSS is the portable path

GitHub Pages serves sites over HTTPS. Although loopback URLs are potentially trustworthy in web
standards, browser behavior for `ws://` from an HTTPS page is not uniform. In particular, relying
on insecure WebSocket from a secure public page is not a portable Safari path. BrowserMCP therefore
uses `wss://127.0.0.1:8789/browser` for published pages.

A non-loopback web app served over plain HTTP is rejected even when it requests a `wss:` Bridge:
an on-path attacker could modify the page code or capture its pairing flow before WSS is opened.
Only loopback HTTP development Origins (`localhost` or `127.0.0.1`) may use local `ws:` mode.

Modern browsers may also gate public-to-loopback requests behind a Local Network Access permission.
The web library makes an explicit, data-free request to the bridge's `/health` endpoint before
opening WebSocket. The bridge returns CORS for a syntactically eligible HTTPS (or loopback
development) Origin so first-time approval can begin, but the response exposes only
`{ "status": "ok" }` and grants no session. Permission is a browser/user decision and is not
bypassed.

References: [GitHub Pages HTTPS](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https),
[W3C Secure Contexts](https://www.w3.org/TR/secure-contexts/),
[Chrome 142 LNA](https://developer.chrome.com/release-notes/142),
[Chrome 147 WebSocket LNA](https://developer.chrome.com/release-notes/147),
[MDN Local Network Access](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Local_network_access), and
[MDN WebSocket security](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_client_applications#security_considerations).

## 1. Generate and trust a local certificate

From the repository root:

```sh
npm run tls:generate -- .browsermcp/tls
```

The Node.js helper invokes an `openssl` executable from `PATH` without a shell, uses native path
handling on macOS, Linux, and Windows, and creates:

```text
.browsermcp/tls/
├── ca-cert.pem
├── ca-key.pem
├── localhost-cert.pem
└── localhost-key.pem
```

The leaf certificate contains both `DNS:localhost` and `IP:127.0.0.1` subject alternative names.
The directory is gitignored. The two private-key files are credentials: never publish, commit,
attach, or paste them. The CA private key can authorize arbitrary certificates if stolen; keep its
permissions restricted, move it to protected offline storage if renewal is required, or destroy it
after the leaf is issued and generate/trust a new CA for renewal.

The helper is optional: the Bridge accepts ordinary PEM certificate/key paths on every supported
OS. Any replacement must issue a server certificate whose SAN contains `IP:127.0.0.1` (and
preferably `DNS:localhost`) and whose private key matches it. Do not substitute a certificate valid
only for `localhost` when the documented endpoint uses `127.0.0.1`.

Trust setup is deliberately manual and platform-specific:

- **macOS:** Inspect `ca-cert.pem`, import only that public CA certificate into the login Keychain
  with Keychain Access, and explicitly trust it for SSL. Safari and Chromium use macOS trust.
  Firefox policy/profile settings can affect whether OS roots are used; see
  [Mozilla's CA guidance](https://support.mozilla.org/en-US/kb/setting-certificate-authorities-firefox).
- **Linux:** Install only `ca-cert.pem` through the distribution's documented user/system CA
  mechanism, then restart the browser. Debian/Ubuntu commonly use
  `/usr/local/share/ca-certificates` plus `update-ca-certificates`; Fedora-family systems commonly
  use the system trust-anchor tooling. Chromium and Firefox packaging can use different stores, so
  confirm the active browser profile rather than assuming system installation is sufficient.
- **Windows:** Run the same npm helper from PowerShell or another Node-capable terminal after
  installing OpenSSL on `PATH`, then import only `ca-cert.pem` into the current user's **Trusted
  Root Certification Authorities** store. Do not import either private key. Chrome and Edge
  normally use Windows trust; Firefox policy/profile behavior must be checked separately. Windows
  does not enforce POSIX `0600` semantics, so verify that the generated directory ACL grants access
  only to the intended user before retaining either private key.

Trusting a local root is a meaningful security decision. Trust only the CA you generated, keep
both private keys restricted, and remove the root from the same OS/browser store when BrowserMCP
is no longer used. The repository and the native macOS app never alter trust automatically.

Do not dismiss a certificate warning and continue. A successful setup has a valid certificate
chain for `https://127.0.0.1:8789` with no browser exception.

## 2. Build and start the cross-platform TLS Bridge

Build the local artifacts:

```sh
npm run build:bridge
```

Start the bridge. No website Origin or browser credential is required on the command line:

```sh
npm run start --workspace @browsermcp/bridge -- \
  --tls-cert .browsermcp/tls/localhost-cert.pem \
  --tls-key .browsermcp/tls/localhost-key.pem
```

The same npm command and Bridge arguments apply on macOS, Linux, and Windows terminals. In native
macOS app mode, select the certificate/key paths and start the same Bridge process there. The
native app is not a different MCP or WSS implementation.
In Windows PowerShell, place the arguments on one line; POSIX `\` line continuation is only
presentation syntax for macOS/Linux shells.

For a custom Pages domain, use that exact Origin instead. An Origin contains scheme, host, and
optional non-default port, but never the repository path. For example,
`https://OWNER.github.io/BrowserMCP/` still has Origin `https://OWNER.github.io`.

This is also a security boundary: every repository project site at
`https://OWNER.github.io/<REPOSITORY>/` shares that same Origin. Approval cannot be restricted
to `/BrowserMCP/`; scripts, storage, and service workers from any same-Origin project are the same
web principal. Pair only if all content under `OWNER.github.io` is trusted. For independent trust,
assign BrowserMCP a dedicated custom hostname/Origin and pair that exact Origin.

The terminal prints each of the following once:

- an HTTPS MCP endpoint and independent MCP bearer token;
- the WSS browser endpoint;
- an HTTPS management URL and independent admin token.

Normal structured logs do not contain these credentials. If terminal output is exposed, restart
the bridge; all credentials and sessions are in memory and are revoked by restart.

## 3. Build the site for a repository subpath

The default Vite base is relative and routing uses the URL hash, so the build has no server-side
fallback requirement. To make the intended repository path explicit:

```sh
VITE_BASE_PATH=/BrowserMCP/ npm run build:site
```

In Windows PowerShell, set and then remove the process-scoped variable explicitly:

```powershell
$env:VITE_BASE_PATH = "/BrowserMCP/"
npm run build:site
Remove-Item Env:VITE_BASE_PATH
```

The publishable directory is `site/dist`. A different repository name must use its matching base
path; a custom domain served from `/` uses `/`.

The build contains only public application assets and structured documentation. Approval, legacy pairing, resume,
MCP, and admin credentials are runtime-only and must never be Vite environment variables.

## 4. Deploy with the repository workflow

The pinned-action workflow in `.github/workflows/pages.yml` runs for every push to `main` and can
also be started with `workflow_dispatch`. It performs these steps in order:

1. Install the lockfile with `npm ci` on Node.js 24.
2. Run `npm run check`, including format, lint, typecheck, unit, integration, and production builds.
3. Read the configured Pages `base_path`, rebuild with that exact `VITE_BASE_PATH`, and upload only
   `site/dist` as the Pages artifact.
4. Deploy through the `github-pages` environment in a separate job with only `pages: write` and
   `id-token: write` permissions.

In GitHub repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions**.
No certificate, private key, Bridge credential, or MCP credential is stored in GitHub. The local
Bridge and its TLS material remain on each operator's machine.

For a different static host, deploy `site/dist` with that host's normal immutable/static artifact
mechanism and set the matching Vite base. Browser pairing, trusted loopback WSS, and exact-Origin
approval are unchanged.

## 5. Connect from the published page

1. Open the HTTPS Pages URL at top level, not in an iframe.
2. Open the site's Connection view.
3. Confirm `wss://127.0.0.1:8789/browser` as the bridge URL.
4. Choose **Check local access**. On Chromium, allow the `loopback-network` permission and any
   operating-system local-network permission if prompted.
5. Choose **Request approval** and keep the tab open. It changes to **Awaiting approval** and shows
   the exact Origin plus the non-secret request suffix and deadline.
6. Open the authenticated Bridge management page, verify the exact Origin and displayed app/runtime
   identity, and choose **Approve** (or **Reject** if anything is unexpected).
7. Confirm the site reports a session, negotiated features, registered Tools/Resources/Prompts,
   recent calls, and no certificate or Origin error.
8. Confirm the Bridge management page now lists the app under connected web apps.

The Bridge never returns an approval credential to the page. The app/runtime/instance values are
self-declared routing identity shown to the operator; after exact-Origin approval succeeds, the
rotated in-memory resume credential is bound to that tuple and bridge session. A legacy one-time
token API remains for clients that cannot wait on the approval protocol, but it is not the site UX.

## 6. Configure the MCP client in TLS mode

Use the one common endpoint and the MCP token printed by this bridge process:

```json
{
  "mcpServers": {
    "browsermcp": {
      "type": "streamable-http",
      "url": "https://127.0.0.1:8789/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_TOKEN_FROM_THIS_PROCESS>"
      }
    }
  }
}
```

The exact configuration shape varies by client. The client must trust the local CA through the
store it actually uses. Native macOS clients normally use Keychain, native Windows clients usually
use Windows certificate policy, and Linux behavior depends on the client/runtime packaging. A
Node.js 24 client can opt into supported system CA handling or use
`NODE_EXTRA_CA_CERTS=/absolute/path/to/ca-cert.pem` (Windows accepts an absolute Windows path) when
its launcher supports environment configuration. See
[Node.js enterprise CA configuration](https://nodejs.org/en/learn/http/enterprise-network-configuration).

Disabling TLS verification is not a supported workaround.

## Verification matrix

| Case | Expected result |
| --- | --- |
| HTTPS page + `ws://` | Site rejects the insecure configuration early and recommends WSS |
| WSS with untrusted or wrong-host certificate | Browser refuses the connection |
| WSS with trusted certificate and eligible unapproved Origin | `/health` succeeds with no state; WebSocket stays pending with no session or registrations |
| Operator rejects or does not decide before expiry | Browser receives `APPROVAL_REJECTED` or `APPROVAL_EXPIRED`; no registration appears |
| Operator approves exact Origin + permission | Waiting site connects and republishes its complete capability snapshot |
| Duplicate or excessive pending requests | Bridge rejects them with `RATE_LIMITED` and keeps bounded state |
| Resume with changed Origin/app/runtime/instance | Resume is rejected |
| Pages subpath refresh/navigation | Hash route and relative assets continue to work without a server rewrite |

Automated tests cover TLS server startup, certificate use by a configured client, strict Origin,
health CORS, protocol authentication, registration, and MCP round trips. Final top-level GitHub
Pages MCP verification still requires the deployed HTTPS Origin, a browser profile with the
generated CA trusted, and user approval for Local Network Access. The Pages job cannot and must not
install local certificate trust or start the operator's loopback Bridge.
All repository verification recorded for this implementation ran on Apple Silicon macOS. The
Linux and Windows instructions describe the implemented portable interface, not completed
platform test results.

## Known browser and operational constraints

- Chrome 142 introduced LNA permission gating for fetch and related requests; Chrome 147 extends
  it to WebSockets. The credential-free `/health` fetch intentionally requests permission before
  WSS. This is current LNA permission behavior, not the retired Private Network Access preflight
  model. See [Chrome 142](https://developer.chrome.com/release-notes/142),
  [Chrome 147](https://developer.chrome.com/release-notes/147), and
  [MDN LNA](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Local_network_access).
- Local Network Access prompts and settings differ by browser version, OS permission, and
  managed-browser policy.
- A top-level page can request permission; an embedded Pages site may also require a delegating
  Permissions Policy from its parent, so embedding is not the supported default.
- Only IPv4 loopback is listened on. The documented URL is `127.0.0.1`, not an arbitrary hostname.
- Changing the GitHub Pages custom domain changes the Origin and requires a new explicit approval.
- Bridge restart revokes MCP, admin, pairing, resume, and UI-session authority.
- Certificate creation and local trust are operational setup, not automatic installation,
  notarization, or public PKI.
- The Bridge accepts the same PEM inputs across platforms, but CA installation/removal and browser
  trust behavior remain OS- and browser-specific operator responsibilities.

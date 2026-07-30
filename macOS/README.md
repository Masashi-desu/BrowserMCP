# BrowserMCP for macOS

`macOS/` contains the optional native menu-bar host for the cross-platform Node.js Bridge in
[`../bridge`](../bridge). It is a real SwiftUI/AppKit `.app`, while the protocol, routing, MCP
endpoint, browser gateway, and security enforcement remain in the platform-neutral Bridge.

The native app has currently been built and tested only on Apple Silicon macOS. The root Bridge is
designed to run anywhere Node.js 24 is supported, but this app target is intentionally macOS-only.

## Requirements

- macOS 14 or newer
- Xcode 26.6 or another current Xcode capable of building the project
- Node.js 24 or newer at runtime
- npm available while building, because the Xcode build phase creates the dependency-complete
  Bridge bundle

The project does not download Node.js, modify certificate trust, install a login item, deploy
anything, sign, or notarize the result.

## Build and test

From the repository root:

```sh
xcodebuild \
  -project macOS/BrowserMCPApp.xcodeproj \
  -scheme BrowserMCPApp \
  -configuration Debug \
  -derivedDataPath /tmp/BrowserMCPDerivedData \
  CODE_SIGNING_ALLOWED=NO \
  build
```

The `Bundle cross-platform Bridge` build phase first runs `npm run build:bridge:bundle`, then copies
the generated `bridge/bundle/browsermcp-bridge.mjs` to
`BrowserMCP.app/Contents/Resources/browsermcp-bridge.mjs`. That MJS contains the Bridge's JavaScript
dependencies, but not the Node.js runtime.

Run the Swift unit and child-process lifecycle tests with:

```sh
xcodebuild \
  -project macOS/BrowserMCPApp.xcodeproj \
  -scheme BrowserMCPApp \
  -configuration Debug \
  -derivedDataPath /tmp/BrowserMCPDerivedData \
  -destination 'platform=macOS,arch=arm64' \
  CODE_SIGNING_ALLOWED=NO \
  test
```

The shared scheme sets `BROWSERMCP_DISABLE_AUTOSTART=1` for tests, so the XCTest host never starts
the real Bridge as an application-launch side effect. Individual lifecycle tests use isolated
temporary child scripts.

Native formatting and Xcode static analysis are separate from the cross-platform npm gate:

```sh
xcrun swift-format lint --strict --recursive macOS/BrowserMCPApp macOS/BrowserMCPAppTests
xcodebuild -project macOS/BrowserMCPApp.xcodeproj -scheme BrowserMCPApp \
  -configuration Debug -derivedDataPath .build/xcode-analyze \
  CODE_SIGNING_ALLOWED=NO analyze
```

## Application behavior

BrowserMCP is an accessory application (`LSUIElement`) and places a status icon in the menu bar. Its
menu distinguishes stopped, starting, running, stopping, and failed states and provides:

- Open BrowserMCP management window
- Start, Stop, and Restart Bridge
- copy MCP and Browser endpoints
- open the authenticated local status UI in the default browser
- quit the app, stopping its child Bridge first

The native management window additionally provides:

- MCP, Browser, and Status endpoint display and copy actions
- MCP/admin bearer display with explicit Reveal and Copy controls
- connected app, Browser session, MCP notification subscription, Tool, Resource, and Prompt counts,
  polled from the bearer-protected `/api/state` endpoint every two seconds
- recent bounded Bridge errors and redacted stderr diagnostics
- pending exact-Origin approval requests with self-declared app/runtime metadata and expiry, plus
  Approve/Reject actions through the bearer-protected `/api/pairing-requests/:id` endpoint
- legacy exact-Origin pairing-token issuance in a collapsed compatibility section through the
  bearer-protected `/api/pairing-tokens` endpoint
- port, allowed Origin, startup pairing Origin, TLS certificate/key, Node executable, and development
  Bridge CLI configuration

The app starts the Bridge with `--json` and accepts only the CLI's single-line `ready` contract.
Endpoint scheme, loopback host, port, path, and credential shape must all agree. If no valid ready
event arrives within ten seconds, it reports failure and terminates the child instead of remaining
in Starting indefinitely. Stop and application termination send `SIGTERM`; an unresponsive owned
child is killed after a bounded grace period. Restart waits for the old process to terminate before
launching a fresh process.

“Start Bridge when app launches” starts the Bridge when this app is opened. It does not register the
app as a macOS login item.

## Node and Bridge resolution

Node resolution is deliberately shell-free. Each executable is run only with `--version`, each
probe is bounded to three seconds, and the result must report major version 24 or later. The app
checks, in order:

1. a Node executable explicitly selected in the UI;
2. the app process `PATH`;
3. `/opt/homebrew/bin/node`, `/usr/local/bin/node`, and `/usr/bin/node`;
4. common Volta, asdf, local, fnm, nvm, and nodenv locations.

For the Bridge script, an explicit `.js`, `.mjs`, or `.cjs` UI selection overrides all defaults.
Otherwise the app uses the dependency-complete MJS in its Resources. A repository
`bridge/dist/cli.js` is the final development fallback. Selected paths are persisted as
non-secret preferences because the app sandbox is disabled so it can launch an external Node
runtime. The app does not execute a shell or accept arbitrary command arguments.

## Credential handling

MCP, admin, and pairing credentials live only in the Bridge process and the current app view model.
They are not written to `UserDefaults`, files, or diagnostic logs. Credentials are masked by
default, reset to masked after every Bridge restart, and require an explicit Reveal or Copy action.
Credential clipboard contents are cleared after 60 seconds only if the pasteboard still contains
the copied value; endpoint clipboard contents are not automatically cleared. The machine-readable
stdout ready line is parsed and discarded, while only bounded, redacted Bridge stderr is displayed.

The status poll uses an ephemeral `URLSession`, does not store cookies, and never disables TLS
validation. TLS certificate and private-key paths are persisted as launch configuration, but their
contents are not copied into app storage. Trust remains an explicit user/system responsibility.

## Manual verification not performed by automated tests

The unsigned build and automated tests verify compilation, bundle inclusion, ready parsing,
credential filtering, Node detection, strict pending-approval parsing, and child
startup/timeout/stop behavior. A
release handoff should also verify the actual menu-bar interaction without disturbing another user
session:

1. launch the unsigned Debug `.app` in an isolated macOS desktop session;
2. confirm there is a menu-bar icon and no Dock icon;
3. open the management window from the menu and exercise Start, Restart, and Stop;
4. confirm endpoints and status counts update, masked values reveal only on request, and Copy works;
5. request access from `/site`, verify the exact Origin and self-declared app/runtime labels appear,
   Reject one request, then submit another and Approve it;
6. open the status UI and confirm the default browser receives the loopback URL without credentials
   in the URL;
7. quit while running and confirm no child `browsermcp-bridge.mjs` process remains.

Expected result: all controls reflect the child lifecycle, the status UI opens on loopback, secrets
remain transient, and quitting leaves no Bridge process. This repository intentionally performs no
signing, notarization, packaging, external publication, or deployment.

# Contributing to BrowserMCP

## Responsibility boundaries

- `packages/protocol` defines the BrowserMCP Bridge Protocol and validates untrusted wire data. It
  must not import the standard MCP SDK or application-specific behavior.
- `packages/web` owns framework-independent browser connection and handler lifecycle. It must not
  translate standard MCP messages.
- `bridge` terminates standard MCP and the browser protocol, enforces the trust boundary, and
  routes generic registrations. Do not add a particular web application's business logic there.
- `macOS` contains only the native menu-bar lifecycle/UI shell. It may launch and observe the
  shared Bridge, but must not duplicate MCP conversion, routing, authentication, or protocol state.
- `site` owns the example product, structured docs corpus, browser-storage/Worker examples, and
  presentation.

## Development workflow

1. Use Node.js 24 LTS or newer and npm 11 or newer. Native macOS app changes also require macOS 14+
   and a current Xcode.
2. Run `npm install` from the repository root.
3. Make the smallest change that preserves the boundaries above.
4. Add tests at the lowest useful boundary and an integration test for changed wire behavior.
5. Update public/API/protocol/security documentation in the same change.
6. Run `npm run check`. For native app changes, also run its unsigned Xcode build and tests.

Biome is the formatter and linter; do not add a second formatting configuration. TypeScript strict
mode is shared through `tsconfig.base.json`. Generated `dist`, coverage, local TLS material, local
environment files, and credentials must not be committed.

## Protocol and security changes

Treat HTTP bodies, WebSocket messages, tool arguments, handler results, browser metadata, and
stored site values as untrusted. New wire fields require:

- a discriminated TypeScript type;
- bounded runtime validation with unknown-field rejection where appropriate;
- compatibility and state-transition documentation;
- malformed-input, secret-redaction, and happy-path tests;
- a conscious protocol version decision.

Do not weaken exact Origin/Host checks, put credentials in URLs, log secrets, bind outside
`127.0.0.1`, install certificate trust automatically, or bypass TLS verification. Security-sensitive
operational steps must remain explicit and reversible.

## Completion checklist

- [ ] Code, README, site docs, and protocol docs agree.
- [ ] `npm run format:check` passes.
- [ ] `npm run lint` passes.
- [ ] `npm run typecheck` passes.
- [ ] `npm run test:unit` passes.
- [ ] `npm run test:integration` passes.
- [ ] `npm run build` passes.
- [ ] The unsigned macOS Debug app builds and its tests pass when native app code changed.
- [ ] No fixed credential, private key, personal path, signing material, or generated deployment
      output was added; Pages changes publish only `site/dist` after all quality gates pass.
- [ ] Implemented, planned, and constrained behavior is labeled accurately.
- [ ] Platform claims remain explicit: only Apple Silicon macOS is currently verified; Linux,
      Windows, and Intel Mac are unverified until results are recorded.

The repository's only external publishing workflow deploys `site/dist` to GitHub Pages from
`main`. Package/release publication, external Bridge hosting, and Apple signing/notarization remain
outside the repository development workflow.

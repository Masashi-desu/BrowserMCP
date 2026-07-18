# BrowserMCP Bridge Protocol 1.1

- Status: implemented
- Protocol identifier: `browsermcp.bridge`
- Current wire version: `1.1.0`
- Supported wire versions: `1.1.0`, `1.0.0`

This protocol is the internal, bidirectional contract between a BrowserMCP web runtime and the
local bridge. It is not MCP and does not tunnel opaque MCP JSON-RPC messages. Standard MCP ends at
the bridge; the bridge translates only validated registrations, invocations, results, errors, and
lifecycle events.

## Transport

The browser opens `/browser` on the bridge's loopback HTTP server using WebSocket text frames. The
development form is `ws://127.0.0.1:8789/browser`. A page served over public HTTPS, including a
GitHub Pages build, uses `wss://127.0.0.1:8789/browser` with a locally trusted certificate whose
subject alternative name includes `127.0.0.1`.

The bridge accepts a plain HTTP page Origin only when that page itself is served from `localhost`
or `127.0.0.1`. Every non-loopback web Origin must be HTTPS; otherwise network injection could
replace the paired page code before it reaches the loopback bridge.

The endpoint rejects query parameters. In particular, credentials never appear in the WebSocket
URL. The browser sends an approval request, a legacy pairing credential, or a resume credential
inside the first validated protocol message. An eligible HTTPS Origin (or loopback HTTP development
Origin) may open a bounded pre-authentication connection to request approval; it cannot register or
invoke anything before the operator accepts it. The WebSocket handshake's observed `Origin` must
exactly match the origin declared in that message.

Only UTF-8 JSON text frames are accepted. The maximum encoded frame is 1 MiB; the bridge may
advertise a lower effective limit but rejects configuration above that shared sender limit. Binary
frames, invalid JSON, excess nesting/collections,
unsafe object keys, unknown fields, unknown message types, and unsupported envelope versions are
rejected.

## Envelope

Every message has the following exact top-level structure:

```ts
interface BridgeMessage<T extends MessageType> {
  protocol: "browsermcp.bridge";
  version: string;
  id: string;
  type: T;
  timestamp: number;
  replyTo?: string;
  payload: MessagePayloads[T];
}
```

- `id` identifies one message and is unique within a connection.
- `replyTo` correlates an acknowledgement, welcome, pong, or error with the triggering message.
- `timestamp` is Unix epoch milliseconds and is diagnostic; it does not replace deadlines or
  credential expiry checks at the receiver.
- `version` is the selected exact wire version after the handshake.
- `sessionId` in an active-state payload must match the session bound to the WebSocket.
- `invocationId` identifies one bridge-to-browser operation through its single terminal result.
- `registrationId` is assigned by the web runtime and unique inside that runtime connection.

Identifiers are bounded to 128 characters and use a conservative ASCII identifier grammar.
Capability names, URLs, schemas, content, and collection counts have separate validation limits.

## Message directions

| Type | Normal sender | Purpose |
| --- | --- | --- |
| `connect` | Browser | First message; identity, Origin, supported versions/features, and approval, legacy pairing, or resume authentication |
| `approval_required` | Bridge | Correlated request ID, exact observed Origin, and decision deadline for the waiting operator action |
| `welcome` | Bridge | Selected version/features, session and rotated resume credential, limits, heartbeat interval |
| `register` | Browser | Publish one Tool, Resource, or Prompt definition after the corresponding feature was negotiated |
| `registered` | Bridge | Confirm a registration; `replyTo` is the `register` message ID |
| `unregister` | Browser | Remove one registration owned by this runtime |
| `unregistered` | Bridge | Confirm removal; `replyTo` is the `unregister` message ID |
| `invoke` | Bridge | Execute a registered Tool call, Resource read, or Prompt get with a bounded timeout |
| `result` | Browser | Return a successful typed Tool, Resource, or Prompt result |
| `error` | Either | Return a structured protocol or handler failure; may reference an invocation |
| `cancel` | Either | Cancel an invocation and abort its browser handler when possible |
| `ping` / `pong` | Either | Application-level liveness with an echoed nonce |
| `disconnect` | Either | Explain closure and whether an authenticated resume is expected |

`approval_required`, `welcome`, `invoke`, `registered`, and `unregistered` are invalid from the browser. A second
`connect` on an authenticated socket is invalid. Before authentication, every type except
`connect` is invalid. After `approval_required`, every browser message is invalid until the Bridge
sends `welcome` or an `error` and closes the connection.

## Connection handshake

The browser advertises explicit versions and features and supplies stable app/runtime identity:

```ts
type ConnectionAuth =
  | { kind: "approval" }
  | { kind: "pairing"; token: string }
  | { kind: "resume"; sessionId: string; token: string };

interface ConnectPayload {
  supportedVersions: string[];
  capabilities: ProtocolCapability[];
  auth: ConnectionAuth;
  app: { id: string; name: string; version: string };
  origin: string;
  runtime: {
    id: string;
    instanceId: string;
    userAgent?: string;
    platform?: string;
    language?: string;
  };
}
```

Approval, legacy pairing, and resume are discriminated alternatives. With `approval`, the Bridge
creates a short-lived pending request, returns `approval_required`, and withholds a session until an
authenticated operator explicitly approves the exact observed Origin and displayed app/runtime
identity. Rejection or expiry returns `APPROVAL_REJECTED` or `APPROVAL_EXPIRED` and closes the
socket. Pending requests are globally and per-Origin bounded and duplicate runtime requests are
suppressed. Approval does not return a credential to page code.

The `pairing` alternative remains a compatibility path. Its token is short-lived, single-use, and
bound to one exact allowed Origin. A reconnect never resends a consumed pairing credential. A
resume token is short-lived, single-use, and bound to session, Origin, app ID, runtime ID, and
instance ID. Successful approval or pairing mints a resume credential; successful resume rotates
it. Failed or replayed credentials close the socket.

Only the WebSocket Origin is a browser-authenticated principal. The app ID/name/version and
runtime/instance values are page-declared routing metadata; initial approval does not independently
authenticate them. A successful operator approval or legacy pairing mints a resume credential
bound to the observed Origin and that declared tuple. Code at the same Origin can claim the same
tuple, so path separation (including
different `OWNER.github.io` project paths) is not a security boundary.

The bridge selects the highest version that appears verbatim in both advertised lists. It does not
infer wire compatibility from SemVer major numbers. Negotiation computes the ordered intersection
of the browser request and bridge support. Versions 1.0 and 1.1 require the following set as one indivisible
prerequisite:

- `tools`
- `resources`
- `prompts`
- `cancellation`
- `session-resume`
- `heartbeat`

If any member is absent after intersection, the bridge returns `CAPABILITY_UNSUPPORTED` and closes
the socket before consuming authentication state. Optional features, if introduced, will be defined
by a future protocol version rather than silently changing existing semantics. The `approval`
authentication variant and `approval_required` message require version 1.1; a version 1.0 peer must
use legacy pairing or resume.

The `welcome` message supplies `session.id`, a rotated `resumeToken` and absolute `expiresAt`, plus
`maxMessageBytes`, `maxConcurrentInvocations`, `requestTimeoutMs`, and `heartbeatIntervalMs`.

## Registrations

A registration is one of the following deliberately MCP-independent definitions:

- Tool: `id`, `name`, optional description, JSON input schema, optional output schema and
  annotations.
- Resource: `id`, `name`, absolute source `uri`, optional description, media type and annotations.
- Prompt: `id`, `name`, optional description, argument definitions and annotations.

Only definitions cross the wire; JavaScript handlers remain in the web library. The bridge
validates registration data and then derives MCP-facing names/URIs using the app ID and an Origin
fingerprint. Two tabs for the same app and Origin intentionally share the stable name. Listing
deduplicates it, while invocation fails with an explicit ambiguous-target error until one provider
remains. A browser disconnect atomically removes every registration owned by that connection.

On reconnect the browser republishes its current registrations after `welcome`. The bridge does
not persist or assume the former snapshot.

If a valid, identity-bound resume credential arrives while the former transport is still half-open,
the bridge atomically retires that exact session's old connection and routes before accepting the
replacement. A pairing attempt or a resume credential for a different session never takes over an
active runtime.

Version 0.1 treats each resource registration as one exact resource, not a URI-template or
subresource family. The browser receives and returns the registered local source URI. The bridge
rejects any result item with a different URI, then rewrites every accepted item to the namespaced
URI requested by the MCP client so `resources/list` and `resources/read` remain consistent.
A runtime cannot register the same exact source URI twice; the second registration is rejected
before it can create a listed-but-ambiguous resource.

## Invocation and results

`invoke` contains the owning registration ID, a new invocation ID, a timeout, and exactly one
operation:

```ts
type InvocationOperation =
  | { kind: "tool.call"; arguments: JsonObject }
  | { kind: "resource.read"; uri: string }
  | { kind: "prompt.get"; arguments?: Record<string, string> };
```

The web library looks up the local handler, creates an `AbortSignal`, enforces the smaller of local
and advertised timeouts, and returns a result whose kind matches the operation:

- Tool results contain MCP-compatible content, optional structured content, and optional `isError`.
- Resource results contain one or more text or base64 resource contents.
- Prompt results contain optional description and user/assistant messages.

The bridge checks connection ownership, invocation identity, and result kind before resolving the
MCP request. A late, duplicate, cross-connection, or wrong-kind result is rejected and cannot
resolve another caller's request.

## Cancellation, timeout, and disconnect

An MCP cancellation aborts the pending bridge request, sends `cancel`, and reaches the handler's
`AbortSignal`. The browser may also cancel its own work. Cancellation, result, error, timeout, and
disconnect race through one terminal pending-request entry, so only the first terminal event wins.

The bridge enforces global and per-runtime concurrency limits and a request timeout even if the
browser does not. On timeout it sends `cancel`, records a timeout outcome, and returns a safe MCP
error. On socket close it removes routes and rejects every request owned by that connection.

Heartbeat messages detect a tab that no longer processes events. The receiver echoes the nonce in
`pong`. Missing activity beyond the bridge grace period closes the connection; a valid unexpired
resume credential may then be used.

## Errors

```ts
interface ErrorPayload {
  sessionId?: string;
  invocationId?: string;
  code: ProtocolErrorCode;
  message: string;
  retryable: boolean;
  details?: JsonValue;
}
```

Defined codes are:

`AUTH_REQUIRED`, `AUTH_INVALID`, `AUTH_EXPIRED`, `APPROVAL_REJECTED`, `APPROVAL_EXPIRED`, `ORIGIN_NOT_ALLOWED`,
`VERSION_UNSUPPORTED`, `CAPABILITY_UNSUPPORTED`, `INVALID_MESSAGE`,
`REGISTRATION_REJECTED`, `REGISTRATION_NOT_FOUND`, `INVOCATION_NOT_FOUND`,
`INVOCATION_TIMEOUT`, `INVOCATION_CANCELLED`, `HANDLER_ERROR`, `SESSION_EXPIRED`,
`SESSION_RESUME_REJECTED`, `RATE_LIMITED`, `CONNECTION_CLOSED`, and `INTERNAL_ERROR`.

Receivers must branch on `code`, not human text. `retryable` is guidance, never permission to reuse
an expired or consumed credential. Unknown future error codes are representable but must be treated
as failures. Details are JSON-bounded and must not contain credentials or unsanitized stack traces.

## Security invariants

- The server is loopback-only and applies strict Host and exact Origin equality checks.
- A WebSocket opening is not authentication; the first valid `connect` is mandatory and timed.
- A pending approval has a finite lifetime and bounded count; it has no session or registrations.
- Declared Origin cannot override the browser-supplied WebSocket Origin.
- Pairing/resume tokens are high-entropy, hashed at rest in memory, expiring, and consumed once.
- Authentication values are message payloads only; they are never URL parameters or registrations.
- Registration and invocation are unavailable before successful version/feature negotiation.
- Payload, concurrency, time, and heartbeat limits are enforced independently by each peer.
- A normal log, status snapshot, MCP error, or browser error must not expose a credential.

The implementation source in `packages/protocol` is the executable schema. This document describes
version `1.1.0` and its documented `1.0.0` compatibility path; incompatible wire changes require a
new explicitly advertised version.

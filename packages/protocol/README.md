# `@browsermcp/protocol`

BrowserMCP Bridge とブラウザランタイムの間だけで使用する、型付き内部プロトコルです。MCP JSON-RPC を透過するプロトコルではありません。標準 MCP の初期化・session・Tool/Resource/Prompt 変換は Bridge の MCP 境界が担当し、この package はブラウザ接続、機能登録、実行中継だけを扱います。

現在の protocol ID は `browsermcp.bridge`、current version は `1.1.0` です。Bridge は legacy
peer向けに `1.0.0` も明示的にnegotiateします。

## 公開 API

```ts
import {
  createBridgeMessage,
  negotiateCapabilities,
  negotiateProtocolVersion,
  parseBridgeMessage,
  safeParseBridgeMessage,
  serializeBridgeMessage,
  PROTOCOL_VERSION,
  type BridgeMessage,
} from "@browsermcp/protocol";
```

- `createBridgeMessage(type, payload, options?)`: 型付き message を作成し、送信前に runtime validation も行います。
- `parseBridgeMessage(input, options?)`: JSON string または unknown value を検証します。不正な入力では `ProtocolValidationError` を送出します。
- `safeParseBridgeMessage`: throw しない `{ success, data | error }` 形式です。
- `serializeBridgeMessage`: 検証済み JSON string を返します。
- `negotiateProtocolVersion`: 両者が明示した version の最高の完全一致を返します。暗黙の major-version 互換性は仮定しません。
- `negotiateCapabilities`: request 順を維持した capability intersection を返します。

`parseBridgeMessage` の既定上限は 1 MiB、JSON depth は 32、配列または object の要素数は 10,000 です。Bridge は自身のより小さい上限を `maxBytes` 等で渡せます。

## Envelope

すべての message は次の envelope を持ちます。既知構造の未知フィールドは拒否されます。

```ts
interface Envelope<TType, TPayload> {
  protocol: "browsermcp.bridge";
  version: string;
  id: string;
  type: TType;
  timestamp: number; // Unix epoch milliseconds
  replyTo?: string;
  payload: TPayload;
}
```

`id` は transport 内の message 相関 ID です。`invocationId` は MCP request と browser handler 実行を相関する別の ID です。`registrationId` は接続した runtime 内の登録を一意に識別します。

## Message types

| type | direction | 必須 payload | 用途 |
| --- | --- | --- | --- |
| `connect` | Web → Bridge | `supportedVersions`, `capabilities`, `auth`, `app`, `origin`, `runtime` | 最初の message。接続・認証・resume を要求します。 |
| `approval_required` | Bridge → Web | `requestId`, `origin`, `expiresAt` | exact Originのoperator判断待ち。`replyTo`はconnect IDです。 |
| `welcome` | Bridge → Web | `selectedVersion`, `capabilities`, `session`, `limits`, `heartbeatIntervalMs` | session 確立、version/capability/limit 確定です。`replyTo` は connect ID です。 |
| `register` | Web → Bridge | `sessionId`, `registration` | Tool、Resource、Prompt を1件登録します。 |
| `registered` | Bridge → Web | `sessionId`, `registrationId` | 登録完了 ack。`replyTo` は register ID です。 |
| `unregister` | Web → Bridge | `sessionId`, `registrationId` | 登録解除を要求します。 |
| `unregistered` | Bridge → Web | `sessionId`, `registrationId` | 解除完了 ack。`replyTo` は unregister ID です。 |
| `invoke` | Bridge → Web | `sessionId`, `invocationId`, `registrationId`, `operation`, `timeoutMs` | ブラウザ handler を呼び出します。 |
| `result` | Web → Bridge | `sessionId`, `invocationId`, `output`, optional `durationMs` | 成功結果です。 |
| `error` | both | `code`, `message`, `retryable`; optional session/invocation/details | handshake、登録、実行、protocol error を返します。request response の場合は `replyTo` を使います。 |
| `cancel` | both | `sessionId`, `invocationId`, optional `reason` | 実行中 request をキャンセルします。 |
| `ping` / `pong` | both | `nonce`, optional `sessionId` | liveness。pong の `replyTo` は ping ID です。 |
| `disconnect` | both | `code`, `canResume`; optional session/reason | 明示的切断と resume 可否を通知します。 |

## Connect と認証

認証は曖昧な複数 credential を同時送信せず、次の discriminated union です。

```ts
type ConnectionAuth =
  | { kind: "approval" }
  | { kind: "pairing"; token: string }
  | { kind: "resume"; sessionId: string; token: string };
```

`approval`はcredentialをWebへ渡さず、Bridge管理画面の明示的なApprove/Rejectを待ちます。
pending中はsessionも登録権限もありません。`pairing` tokenは互換経路として短命かつ一回限り
です。resume成功時、Bridgeは`welcome.session.resumeToken`を必ずローテーションします。
Web runtimeは古いtokenを再利用しません。resume grantはsession IDだけでなくapp ID、origin、
runtime ID、instance IDに束縛されます。

`connect` の識別情報は次の責務を持ちます。

- `app.id`: Web アプリの論理 ID。
- `runtime.id`: 同一アプリ内の runtime 系列 ID。
- `runtime.instanceId`: tab または実行 instance ID。同一アプリの複数 tab を区別します。
- `origin`: Web 側の宣言値。Bridge は WebSocket `Origin` header と完全一致することを確認し、宣言だけを信頼しません。

## Registrations と operations

登録は `CapabilityRegistration` union です。

- Tool: `kind`, `id`, `name`, `inputSchema`、optional description/outputSchema/annotations。
- Resource: `kind`, `id`, `name`, absolute `uri`、optional description/mimeType/annotations。
- Prompt: `kind`, `id`, `name`、optional description/arguments/annotations。

実行 operation と result は registration kind に対応します。

| registration | operation | result |
| --- | --- | --- |
| `tool` | `{ kind: "tool.call", arguments }` | `{ kind: "tool", content, structuredContent?, isError? }` |
| `resource` | `{ kind: "resource.read", uri }` | `{ kind: "resource", contents }` |
| `prompt` | `{ kind: "prompt.get", arguments? }` | `{ kind: "prompt", description?, messages }` |

この形は MCP JSON-RPC message ではありません。Bridge が標準 MCP の `tools/call`、`resources/read`、`prompts/get` との変換と namespace 解決を担当します。

Version 0.1 のresource registrationは1件のexact resourceです。Browserは登録時のlocal URIを`resource.read`で受け、同じURIを各`contents` itemで返します。Bridgeは不一致を拒否し、標準MCP responseではnamespaced公開URIへ書き換えます。URI templateや任意subresource familyはこのversionの対象外です。

## State transitions

```text
socket accepted
  -> awaiting connect
  -> negotiating + optional operator approval
  -> connected session
  -> registrations / invocations / heartbeat
  -> disconnect or transport close
  -> registrations removed
  -> optional resume with rotated credential
```

- `connect` より前に他の message は受理しません。
- session 確立後の `sessionId` は socket に束縛された値と一致する必要があります。
- 切断時、Bridge はその connection に属する全登録と pending invocation を除去します。
- resume では Web runtime が全登録を再送します。古い connection の登録を引き継いだものとして扱いません。
- 同一 app/runtime/instance の競合方針と MCP namespace は Bridge registry の責務です。

## Version と capabilities

`connect.supportedVersions` と Bridge の supported list の完全一致から最高 version を選びます。共通 version がなければ `VERSION_UNSUPPORTED` で切断します。capability negotiation 自体は request と support の intersection を返しますが、version 1.0/1.1 では次の6件を一体の必須集合として扱います。`approval`と`approval_required`は1.1以降です。

```text
tools, resources, prompts, cancellation, session-resume, heartbeat
```

intersection 後に1件でも欠ける場合、Bridge は credential を消費する前に `CAPABILITY_UNSUPPORTED` を返して接続を閉じます。未知 capability 名は拡張用に構文検証後保持されますが、相手側が明示的に対応しない限り negotiated list には入りません。将来optional capabilityを導入する場合は、挙動を曖昧に変えず新しいprotocol versionで定義します。

## Validation と security

- envelope、app/runtime/session、registration、operation、result の未知 field を拒否します。
- JSON Schema、tool arguments、structured content、error details、annotations だけを明示的な自由 JSON 領域として扱います。
- 自由 JSON も size、depth、collection count、finite number を検証し、`__proto__`、`prototype`、`constructor` key を拒否します。
- Origin は path、query、fragment、userinfo のない absolute HTTP(S) origin だけです。
- token は 16–4096 characters に制限されます。validation error は入力値や token を error message に含めません。
- message type、registration kind、operation kind、content type、prompt role、resource content の曖昧な組み合わせを拒否します。
- object input は plain object だけを受け付け、class instance や循環参照を拒否します。

Protocol package 自体は認証 token の発行・保存・照合、Origin header 検証、rate limit、network bind を実装しません。それらは Bridge/Web transport 境界の責務です。

## Errors

代表 code は `AUTH_REQUIRED`、`AUTH_INVALID`、`AUTH_EXPIRED`、`APPROVAL_REJECTED`、`APPROVAL_EXPIRED`、`ORIGIN_NOT_ALLOWED`、`VERSION_UNSUPPORTED`、`REGISTRATION_REJECTED`、`INVOCATION_TIMEOUT`、`INVOCATION_CANCELLED`、`HANDLER_ERROR`、`SESSION_RESUME_REJECTED`、`RATE_LIMITED`、`INVALID_MESSAGE` です。将来の拡張 code も uppercase identifier として保持できます。`image` / `audio` の `data` と resource の `blob` は、標準 MCP 境界で安全に扱える canonical Base64（空文字を含む）に限定されます。

Runtime validation error は wire `error` とは別の `ProtocolValidationError` で、`code`、`path`、秘密値を含まない `message` を持ちます。

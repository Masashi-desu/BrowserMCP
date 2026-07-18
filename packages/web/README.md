# `@browsermcp/web`

Web ページを BrowserMCP runtime にする、UI framework 非依存の TypeScript library です。Tool、Resource、Prompt handler はブラウザ内で動作し、Web Worker、WebAssembly、IndexedDB、Canvas、File System Access API などを通常の Web API として利用できます。

この package は標準 MCP server ではありません。内部 BrowserMCP Bridge Protocol を使って local Bridge に接続し、Bridge が標準 MCP との変換を担当します。

## 最小例

```ts
import { BrowserMCP } from "@browsermcp/web";

const app = new BrowserMCP({
  name: "Example App",
  version: "0.1.0",
  appId: "example.app",
  // 公開 HTTPS ページでは credential-free health fetch で LNA を準備します。
  prepareLocalNetworkAccess: true,
});

app.tool({
  name: "example.uppercase",
  description: "Convert text to uppercase in the browser",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  },
  handler: async ({ text }, context) => ({
    content: [{ type: "text", text: String(text).toUpperCase() }],
    structuredContent: { runtime: "browser" },
  }),
});

await app.connect();
```

既定接続先は `wss://127.0.0.1:8789/browser` です。credentialがなければ`connect()`は
exact Originのoperator承認を申請し、snapshotは`awaiting-approval`と非secretのrequest情報を
返します。Bridge管理画面でApproveされるまでsessionもregistrationも成立しません。

## Registrations

`tool`、`resource`、`prompt` は同期的に宣言し、`RegistrationHandle` を返します。接続前の登録は `welcome` 後にまとめて送信され、接続中の登録は動的に送信されます。

```ts
const resource = app.resource({
  name: "notes.current",
  uri: "browsermcp://notes/current",
  mimeType: "application/json",
  handler: async ({ uri }, { signal }) => ({
    contents: [{ uri, text: JSON.stringify(await loadNotes({ signal })) }],
  }),
});

const prompt = app.prompt({
  name: "notes.summarize",
  arguments: [{ name: "style", required: false }],
  handler: ({ style = "concise" }) => ({
    messages: [
      { role: "user", content: { type: "text", text: `Summarize notes in a ${style} style.` } },
    ],
  }),
});

await app.connect();
await Promise.all([resource.ready, prompt.ready]);
await resource.unregister();
```

Bridge が unregister を拒否または timeout した場合、local handler は削除されません。これにより Bridge に route が残り local handler だけ消える不整合を防ぎます。切断中の unregister は local から直ちに削除され、次回接続時に再登録されません。

## Handler context、timeout、cancel

handler の第2引数は次を提供します。

```ts
interface InvocationContext {
  signal: AbortSignal;
  invocationId: string;
  sessionId: string;
  timeoutMs: number;
  log(level, event, data?): void;
}
```

実効 timeout は Bridge の request timeout、invoke message の timeout、library の `invocationTimeoutMs` の最小値です。timeout または `cancel` を受信すると `signal` が abort され、`INVOCATION_TIMEOUT` または `INVOCATION_CANCELLED` を返します。Web API や Worker 呼び出しへ `signal` を渡し、実処理も停止できるようにしてください。

同時実行数は `welcome.limits.maxConcurrentInvocations` を超えず、超過 request は `RATE_LIMITED` になります。

## Connection lifecycle

```ts
await app.connect();
await app.reconnect();
await app.disconnect({ reason: "User action" });
```

状態は `idle → connecting → awaiting-approval → connected`、切断後は `disconnected`、自動再接続中は `reconnecting`、回復不能または明示的に抑止した失敗は `error` です。

- unexpected close では既定で deterministic exponential backoff により最大5回再接続します。
- `reconnect: false` で自動再接続を無効化できます。
- reconnect 前に旧 WebSocket の close を待ち、同じ runtime instance の server-side cleanup と新 handshake の競合を避けます。
- 初回接続は既定でoperator approvalを申請します。接続後は短命resume tokenをmemoryに保持し、再接続時にapp/origin/runtime/instance identityと共に使います。
- resume成功時はtokenがローテーションされます。resume拒否時はcredentialを消去し、自動retry loopを止めます。利用者が明示的に`connect()`または`reconnect()`して新しいapprovalを申請してください。
- `AUTH_REQUIRED`、期限切れ、auth/resume rejection、Bridge の `canResume: false` disconnect のような非 retryable failure は自動再接続しません。network 系の retryable failure だけを再試行します。
- 明示的 `disconnect()` は既定で resume credential を消去します。transport restart の内部的用途に限り `preserveSession: true` を指定できます。
- 同時 `connect`、`reconnect`、`disconnect` は同種 operation の Promise を共有します。disconnect 中の connect は cleanup 完了後まで待機し、reconnect 中の connect はその attempt に合流します。reconnect 中の disconnect は reconnect 完了後に直列実行され、古い operation が新 socket/state を上書きしません。
- 非同期 `sessionStore.save` の完了も socket、generation、handshake、connect message、state に束縛します。旧 generation の遅延成功・失敗は新しい接続を connected/error に遷移させず、新しい credential を消去しません。

constructorの`token`、`connect({ token })`、`getToken()`はlegacy token互換経路です。
constructor tokenは最初のauth解決時に一回だけ取り出し、すべてattempt-localで保存しません。

永続 resume が必要なら `sessionStore` を注入できます。保存値には bearer credential が含まれるため、平文 `localStorage` へ無条件に保存しないでください。既定 store は BrowserMCP instance 内の memory だけなので、同じ instance の network reconnect は resume できますが、page reload や tab close 後は新しいoperator approvalが必要です。custom store で reload をまたぐには、同じ Origin/app に加えて同じ `runtimeId` と `instanceId` を安全に復元する必要があります。IDを再生成した場合は保存 credential を消去して新しいapprovalを申請し、1つの `instanceId`/credential を複数tabで共有してはいけません。

custom `sessionStore` の load/save/clear failure は `SESSION_STORE_FAILED` です。save failure では接続を成立させず memory credential を破棄し、best-effort clear を行います。明示 disconnect の clear failure は呼び出し元へ error を返しますが、transport close、memory cleanup、`disconnected` state への遷移は必ず完了します。永続 store の暗号化、アクセス制御、atomicity、失敗後に残り得る外部データの消去は埋め込みアプリの security responsibility です。

BrowserMCP Bridge Protocol 1.1 は`approval`/`approval_required`を追加し、1.0互換も明示的に
negotiateします。両versionとも`tools`、`resources`、`prompts`、`cancellation`、
`session-resume`、`heartbeat`の6 capabilityを不可分の必須集合として確認します。

## 公開 HTTPS 静的サイトからの接続

GitHub Pages 等の HTTPS page は mixed-content 制約により `ws://` loopback へ接続できません。Safari を含むこの制約を WebSocket error まで遅延させず、library は secure page と `ws:` の組み合わせを `INSECURE_BRIDGE_URL` で事前拒否します。さらに localhost/127.0.0.1 以外の HTTP page は、page code と pairing flow が network attacker に改変され得るため `ws:`/`wss:` のどちらも拒否します。公開 static app 自体を HTTPS で配信し、信頼済み loopback certificate を使う `wss://127.0.0.1:8789/browser` が必要です。

Chromium 系の Local Network Access permission と証明書問題は、credential-free health request で WebSocket 前に診断できます。Chrome 142 は fetch 等を permission 対象にし、Chrome 147 は loopback WebSocket も対象にしました。先に `/health` を実行して `loopback-network` とOS側のLocal Network permissionが提示された場合は許可し、その後WSSを開く順序です。これは現行LNA permissionであり、旧Private Network Access preflightではありません。

```ts
await app.prepareLocalNetworkAccess();
// または constructor/connect option:
await app.connect({ prepareLocalNetworkAccess: true });
```

request は `GET https://127.0.0.1:8789/health`、`credentials: "omit"`、`targetAddressSpace: "loopback"`、`redirect: "error"` です。対応しない browser は拡張 field を無視します。失敗時の `LOCAL_NETWORK_ACCESS_FAILED` は LNA permission、Bridge 起動状態、loopback certificate trust を確認する案内を含みます。

接続先と health override は `localhost` または `127.0.0.1` だけに制限されます。Bridge は IPv4-only なので `[::1]` は明示的に拒否します。userinfo、query、fragment は拒否されるため token を URL に混入できません。Bridge は実際のWebSocket Origin headerと宣言Originの完全一致を確認し、operator approval前の登録を拒否します。

ローカル HTTP 開発ページだけは、明示指定した `ws://127.0.0.1:8789/browser` を利用できます。

## State、recent executions、logs

```ts
const unsubscribe = app.subscribe((snapshot) => {
  renderConnectionState(snapshot.connectionState);
  renderRegistrations(snapshot.registrations);
  renderRecent(snapshot.recentExecutions);
});

app.getSnapshot();
app.getRegistrations();
app.getRecentExecutions();
app.getLogs();
unsubscribe();
```

snapshot の session 情報は `id` と `expiresAt` だけで、resume token を公開しません。recent execution は running/success/error/timeout/cancelled、duration、registration を保持します。保持件数は `maxRecentExecutions` と `maxLogEntries` で制限できます。

ログの `token`、`secret`、`password`、`authorization`、`credential` key は `[REDACTED]` になります。値中の `bmp_pair_*`、`bmp_resume_*`、`bmp_mcp_*`、`bmp_admin_*`、`bmp_ui_*` と Bearer credential に加え、URL userinfo と `token`、`access_token`、`api_key`、`auth`、`code`、`password` 等の query value（大小文字・percent-encoded nameを含む）も redaction されます。これは arbitrary text 全体の secret detector ではありません。handler result 本文を diagnostic log へ渡さず、アプリ側でも allow-list した構造 metadata だけを記録してください。内部 log、`getLogs()` の返却値、`logger` callback の値は nested JSON まで deep-freeze し、外部向けの2経路はそれぞれ deep-clone するため、呼び出し側の変更で内部保持値を改変できません。logger callback や subscriber の例外は runtime を停止しません。

## WebSocket factory injection

test、WebView、独自 transport adapter では DOM-compatible factory を注入できます。

```ts
const app = new BrowserMCP({
  name: "Embedded App",
  version: "0.1.0",
  origin: "https://embedded.example",
  getToken,
  webSocketFactory: (url) => customWebSocket(url),
});
```

factory に渡される URL に token は含まれません。戻り値は `readyState`、`send`、`close`、`addEventListener`、`removeEventListener` を実装します。

## 静的ファイルとして読み込む

publish 前の build artifact を静的配信する場合は、Web package と Protocol package の `dist` を同じ site に配置し、bare package specifier を import map で解決できます。専用 backend は不要です。

```html
<script type="importmap">
  {
    "imports": {
      "@browsermcp/protocol": "/vendor/browsermcp/protocol/index.js",
      "@browsermcp/web": "/vendor/browsermcp/web/index.js"
    }
  }
</script>
<script type="module">
  import { BrowserMCP } from "@browsermcp/web";
  // Register browser capabilities here.
</script>
```

GitHub Pages の repository subpath では `/vendor/...` の代わりに base path を含む相対 URL を使います。一般的な bundler や Vite を使う場合、import map は不要です。

## 主な options

| option | default | 説明 |
| --- | --- | --- |
| `name`, `version` | required | app identity。version は SemVer。 |
| `appId` | name 由来 | 安定した論理 app ID。製品コードでは明示推奨。 |
| `bridgeUrl` | `wss://127.0.0.1:8789/browser` | loopback WebSocket endpoint。 |
| `token` / `getToken` | none | 短命 pairing token。constructor token は一回消費、provider/explicit token は attempt-local。 |
| `origin` | `location.origin` | browser 外 test 用。Bridge は header と照合します。 |
| `runtimeId`, `instanceId` | generated | 複数 app/tab/runtime の識別。 |
| `reconnect` | backoff 5回 | false または delay/attempt options。 |
| `connectTimeoutMs` | 7,500 | open + handshake timeout。 |
| `approvalTimeoutMs` | 130,000 | operator approvalを待つ上限。Bridge側expiryも優先します。 |
| `invocationTimeoutMs` | 30,000 | handler timeout の library 上限。 |
| `sessionStore` | memory | resume credential store。 |
| `prepareLocalNetworkAccess` | false | connect 前 health request。 |
| `webSocketFactory` | global `WebSocket` | transport test/adapter injection。 |

## Known constraints

- Resource registration は初期実装では exact URI です。URI template は未実装です。
- approval判断UI/APIとlegacy pairing token発行はBridgeの責務です。このpackageは固定secretを生成しません。
- browser の LNA UI、certificate trust、Safari/Chromium の policy は library から迂回できません。明確な事前診断と再現手順を提供します。
- static file を `<script type="module">` で直接使う場合は、両 package の ESM build artifact と上記 import map を配信します。単一ファイル IIFE bundle は未提供です。npm 公開と CDN 公開は本作業の対象外です。

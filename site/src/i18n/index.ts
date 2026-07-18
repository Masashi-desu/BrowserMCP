import { fullUiMessageOverrides } from "./full-overrides.js";

export const SUPPORTED_LOCALES = [
  "en",
  "ja",
  "zh-CN",
  "es",
  "hi",
  "ar",
  "pt-BR",
  "bn",
  "ru",
] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export type TextDirection = "ltr" | "rtl";

export interface LocaleDefinition {
  readonly locale: SupportedLocale;
  readonly nativeName: string;
  readonly direction: TextDirection;
}

export const localeDefinitions: readonly LocaleDefinition[] = [
  { locale: "en", nativeName: "English", direction: "ltr" },
  { locale: "ja", nativeName: "日本語", direction: "ltr" },
  { locale: "zh-CN", nativeName: "简体中文", direction: "ltr" },
  { locale: "es", nativeName: "Español", direction: "ltr" },
  { locale: "hi", nativeName: "हिन्दी", direction: "ltr" },
  { locale: "ar", nativeName: "العربية", direction: "rtl" },
  { locale: "pt-BR", nativeName: "Português (Brasil)", direction: "ltr" },
  { locale: "bn", nativeName: "বাংলা", direction: "ltr" },
  { locale: "ru", nativeName: "Русский", direction: "ltr" },
];

export const englishMessages = {
  "common.skip": "Skip to content",
  "common.language": "Language",
  "common.languageSelect": "Select display language",
  "common.primaryNavigation": "Primary navigation",
  "common.overview": "Overview",
  "common.docs": "Docs",
  "common.connection": "Connection",
  "common.architecture": "Architecture",
  "common.security": "Security",
  "common.development": "Development",
  "common.roadmap": "Roadmap",
  "common.tagline": "The browser is the MCP runtime.",
  "common.bridgeConnected": "Bridge connected",
  "common.idle": "Idle",
  "common.connected": "Connected",
  "common.connecting": "Connecting",
  "common.awaitingApproval": "Awaiting approval",
  "common.reconnecting": "Reconnecting",
  "common.disconnected": "Disconnected",
  "common.error": "Error",
  "common.registered": "Registered",
  "common.pending": "Pending",
  "common.success": "Success",
  "common.running": "Running",
  "common.failed": "Failed",
  "common.ready": "Ready",
  "common.check": "Check",
  "common.blocked": "Blocked",
  "common.none": "None",
  "common.active": "Active",
  "common.resumeAvailable": "Resume available",
  "common.unchecked": "Unchecked",
  "common.checking": "Checking",
  "common.reachable": "Reachable",
  "common.implemented": "Implemented",
  "common.partial": "Partial",
  "common.planned": "Planned",
  "common.constraint": "Constraint",
  "common.source": "Source: {source}",
  "common.related": "Related: {reference}",
  "common.codeExample": "{language} code example",
  "notFound.kicker": "404 · Route not found",
  "notFound.title": "This runtime has no page at that path.",
  "notFound.path": "Unknown route: {path}",
  "notFound.return": "Return to documentation",
  "landing.heroBefore": "The browser is the ",
  "landing.heroHighlight": "MCP runtime.",
  "landing.lede":
    "Expose the logic already living in a web app—JavaScript, Workers, WASM, IndexedDB, Canvas, and Web APIs—through one secure local Bridge.",
  "landing.readDocs": "Read the docs",
  "landing.connectBridge": "Connect the Bridge",
  "landing.proofEndpoint": "One MCP endpoint",
  "landing.proofOrigin": "Exact-Origin approval",
  "landing.proofBrowser": "Browser-owned execution",
  "landing.architectureTitle": "One client configuration. Any paired web app.",
  "landing.architectureText":
    "Standard MCP stops at the Bridge. A separate typed protocol carries requests into the browser, keeping app logic out of the local service and optional native shell.",
  "landing.standardMcp": "01 · STANDARD MCP",
  "landing.mcpClient": "MCP Client",
  "landing.streamableHttp": "Streamable HTTP",
  "landing.localRouter": "02 · LOCAL ROUTER",
  "landing.localBridge": "Local Bridge",
  "landing.execution": "03 · EXECUTION",
  "landing.browserApp": "BrowserMCP App",
  "landing.why": "Why BrowserMCP",
  "landing.contextTitle": "Keep execution where the context lives.",
  "landing.contextText":
    "A static application can become a capable MCP runtime without an app-specific server or another client entry.",
  "landing.featureBackendTitle": "No duplicate backend",
  "landing.featureBackendText":
    "Handlers execute beside the app's state, browser storage, and Web APIs.",
  "landing.featureBridgeTitle": "One common Bridge",
  "landing.featureBridgeText":
    "Configure http://127.0.0.1:8789/mcp once, then pair apps explicitly.",
  "landing.featureTypedTitle": "Typed separation",
  "landing.featureTypedText":
    "Standard MCP and the internal Bridge Protocol stay separate and versioned.",
  "landing.featureStaticTitle": "Static by design",
  "landing.featureStaticText":
    "Use npm, ESM, Vite, or a static host. No application server is required.",
  "landing.featureManyTitle": "Built for many apps",
  "landing.featureManyText":
    "Origin, runtime, and tab identity make routing and collisions inspectable.",
  "landing.featureSecurityTitle": "Security is structural",
  "landing.featureSecurityText":
    "Loopback-only transport, exact Origin approval, finite limits, cancellation, and redacted logs.",
  "landing.minimal": "Minimal app",
  "landing.declareTitle": "Declare a browser capability. Connect once.",
  "landing.declareText":
    "The web library hides transport, negotiation, correlation, timeout, cancellation, and reconnect behavior behind a small public API.",
  "landing.pairingNote":
    "The browser requests access; the operator approves the exact Origin in the local Bridge. No browser-side token is required.",
  "landing.sourceDocs": "Source-backed documentation",
  "landing.docsTitle": "Built for developers—and development agents.",
  "landing.docsText":
    "The visible docs and Docs MCP share one typed corpus, with cross-page search, API and type lookup, examples, troubleshooting, status, sources, and next references.",
  "landing.exploreDocs": "Explore {count} documentation areas",
  "docs.navigation": "Documentation navigation",
  "docs.documentation": "Documentation",
  "docs.areas": "{count} areas",
  "docs.kicker": "BrowserMCP Documentation",
  "docs.title": "Build with the browser as your runtime.",
  "docs.lede":
    "Search concepts, responsibilities, API and types, examples, configuration, protocol behavior, security constraints, and diagnosis from one structured corpus.",
  "docs.pages": "{count} pages",
  "docs.sections": "{count} sections",
  "docs.implemented": "{count} implemented",
  "docs.planned": "{count} planned",
  "docs.constraints": "{count} constraints",
  "docs.searchLabel": "Search BrowserMCP documentation",
  "docs.searchPlaceholder": "Search setup, app.tool, Origin errors, collisions…",
  "docs.searchHint":
    "Search the structured index. Results include status, source, exact page/section, code, and related material.",
  "docs.noResults": "No indexed section matched. Try a responsibility, API name, error, or task.",
  "docs.areasLabel": "Documentation areas",
  "docs.sectionCount": "{count} sections →",
  "docs.onThisPage": "On this page",
  "docs.onThisPageLabel": "On this page",
  "docs.adjacent": "Adjacent documentation pages",
  "docs.backToIndex": "Back to docs index →",
  "connection.siteRuntime": "BrowserMCP Site Runtime",
  "connection.title": "Connection & session status",
  "connection.lede":
    "This entire site is one BrowserMCP app. Request approval for the exact page Origin, establish a browser session, and inspect every registered Tool, Resource, Prompt, invocation, result, and safe error.",
  "connection.transport": "Transport",
  "connection.session": "Session",
  "connection.registrations": "Registrations",
  "connection.localAccess": "Local access",
  "connection.noSession": "No active session ID",
  "connection.capabilityKinds": "Tools, Resources, and Prompts",
  "connection.healthHint": "Run a credential-free /health check",
  "connection.explicitPairing": "Explicit Origin approval",
  "connection.connectTitle": "Request access from the common local Bridge",
  "connection.connectText":
    "Any published HTTPS page, including static hosting, must use WSS with a trusted local certificate. Local HTTP development may use WS on 127.0.0.1. Only loopback Bridge URLs are accepted.",
  "connection.bridgeUrl": "Bridge WebSocket URL",
  "connection.connect": "Request approval",
  "connection.checkAccess": "Check local access",
  "connection.reconnect": "Reconnect",
  "connection.disconnect": "Disconnect",
  "connection.tokenNote":
    "The browser submits the exact Origin and app identity. Approve the waiting request in the Bridge management page; this static page does not receive or store an approval token.",
  "connection.approvalPending":
    "Keep this tab open, verify the exact Origin and app identity in the Bridge management page, then choose Approve or Reject.",
  "connection.readiness": "Secure-page readiness",
  "connection.fourChecks": "Four checks before approval",
  "connection.troubleshooting": "Open troubleshooting",
  "connection.recentError": "Most recent connection error",
  "connection.diagnosticOrder": "Follow the diagnostic order",
  "connection.liveSnapshot": "Live capability snapshot",
  "connection.registeredHere": "Registered with this site runtime",
  "connection.tools": "Tools",
  "connection.resources": "Resources",
  "connection.prompts": "Prompts",
  "connection.noRegistrations": "No registrations reported.",
  "connection.requests": "Requests",
  "connection.recentExecutions": "Recent browser executions",
  "connection.noExecutions": "No browser invocation has completed in this tab yet.",
  "connection.outcome": "Outcome",
  "connection.latest": "Latest result & safe logs",
  "connection.noResult": "No result recorded yet.",
  "connection.noEvents": "No diagnostic events yet.",
  "connection.diagnosticTransport": "Loopback transport",
  "connection.diagnosticTransportReady": "{endpoint} is a loopback-only endpoint.",
  "connection.diagnosticCertificate": "Trusted local certificate",
  "connection.diagnosticCertificateSecure":
    "The browser must trust the Bridge's localhost certificate before WebSocket setup.",
  "connection.diagnosticCertificateDevelopment":
    "Local HTTP development does not use TLS; published HTTPS pages must use WSS.",
  "connection.diagnosticCertificateAction":
    "Install and explicitly trust the generated local CA, then open https://{host}/health. Do not bypass a certificate warning.",
  "connection.diagnosticOrigin": "Exact Origin approval",
  "connection.diagnosticOriginDetail":
    "Approve exactly {origin}; scheme, host, and port are significant.",
  "connection.diagnosticOriginAction":
    "Request access here, then approve this exact Origin in the Bridge management page.",
  "connection.diagnosticNetwork": "Local network permission",
  "connection.diagnosticNetworkDetail":
    "Chrome 142 gates fetch-like loopback requests; Chrome 147 extends LNA permission to WebSockets.",
  "connection.diagnosticNetworkAction":
    "Allow loopback access when prompted and ensure the Bridge health response permits this Origin.",
} as const;

export type MessageKey = keyof typeof englishMessages;
type MessageOverrides = Partial<Record<MessageKey, string>>;

const japaneseMessages: MessageOverrides = {
  "common.skip": "本文へ移動",
  "common.language": "言語",
  "common.languageSelect": "表示言語を選択",
  "common.primaryNavigation": "メインナビゲーション",
  "common.overview": "概要",
  "common.docs": "ドキュメント",
  "common.connection": "接続",
  "common.architecture": "アーキテクチャ",
  "common.security": "セキュリティ",
  "common.development": "開発",
  "common.roadmap": "ロードマップ",
  "common.tagline": "ブラウザがMCPランタイムになる。",
  "common.bridgeConnected": "Bridge接続済み",
  "common.idle": "待機中",
  "common.connected": "接続済み",
  "common.connecting": "接続中",
  "common.awaitingApproval": "承認待ち",
  "common.reconnecting": "再接続中",
  "common.disconnected": "未接続",
  "common.error": "エラー",
  "common.registered": "登録済み",
  "common.pending": "待機中",
  "common.success": "成功",
  "common.running": "実行中",
  "common.failed": "失敗",
  "common.ready": "準備完了",
  "common.check": "要確認",
  "common.blocked": "ブロック",
  "common.none": "なし",
  "common.active": "有効",
  "common.resumeAvailable": "再開可能",
  "common.unchecked": "未確認",
  "common.checking": "確認中",
  "common.reachable": "到達可能",
  "common.implemented": "実装済み",
  "common.partial": "一部実装",
  "common.planned": "計画中",
  "common.constraint": "制約",
  "common.source": "出典: {source}",
  "common.related": "関連: {reference}",
  "common.codeExample": "{language}のコード例",
  "notFound.kicker": "404 · ページが見つかりません",
  "notFound.title": "このランタイムには指定されたパスのページがありません。",
  "notFound.path": "不明なルート: {path}",
  "notFound.return": "ドキュメントへ戻る",
  "landing.heroBefore": "ブラウザが ",
  "landing.heroHighlight": "MCPランタイムになる。",
  "landing.lede":
    "WebアプリにすでにあるJavaScript、Worker、WASM、IndexedDB、Canvas、Web APIのロジックを、安全なローカルBridgeひとつで公開します。",
  "landing.readDocs": "ドキュメントを読む",
  "landing.connectBridge": "Bridgeに接続",
  "landing.proofEndpoint": "MCPエンドポイントは1つ",
  "landing.proofOrigin": "正確なOriginを承認",
  "landing.proofBrowser": "ブラウザ内で実行",
  "landing.architectureTitle": "クライアント設定は1つ。ペアリングしたどのWebアプリにも。",
  "landing.architectureText":
    "標準MCPはBridgeまでです。型付きの別プロトコルが要求をブラウザへ運び、アプリ固有ロジックをローカルサービスや任意のネイティブシェルから分離します。",
  "landing.standardMcp": "01 · 標準MCP",
  "landing.mcpClient": "MCPクライアント",
  "landing.streamableHttp": "Streamable HTTP",
  "landing.localRouter": "02 · ローカルルーター",
  "landing.localBridge": "ローカルBridge",
  "landing.execution": "03 · 実行",
  "landing.browserApp": "BrowserMCPアプリ",
  "landing.why": "BrowserMCPを選ぶ理由",
  "landing.contextTitle": "コンテキストがある場所で実行する。",
  "landing.contextText":
    "静的アプリでも、アプリ専用サーバーや追加のクライアント設定なしに高機能なMCPランタイムになれます。",
  "landing.featureBackendTitle": "バックエンドを重複させない",
  "landing.featureBackendText":
    "ハンドラーはアプリの状態、ブラウザストレージ、Web APIのそばで動きます。",
  "landing.featureBridgeTitle": "共通Bridgeは1つ",
  "landing.featureBridgeText":
    "http://127.0.0.1:8789/mcp を一度設定し、アプリを明示的にペアリングします。",
  "landing.featureTypedTitle": "型付きの責務分離",
  "landing.featureTypedText":
    "標準MCPと内部Bridge Protocolを分離し、それぞれをバージョン管理します。",
  "landing.featureStaticTitle": "静的配信を前提に設計",
  "landing.featureStaticText": "npm、ESM、Vite、静的ホストで利用でき、アプリサーバーは不要です。",
  "landing.featureManyTitle": "複数アプリに対応",
  "landing.featureManyText": "Origin、ランタイム、タブIDによりルーティングと競合を調査できます。",
  "landing.featureSecurityTitle": "構造としてのセキュリティ",
  "landing.featureSecurityText":
    "loopback限定通信、厳密なOrigin承認、上限、キャンセル、ログ秘匿化を備えます。",
  "landing.minimal": "最小構成のアプリ",
  "landing.declareTitle": "ブラウザ機能を宣言し、一度接続する。",
  "landing.declareText":
    "Webライブラリが通信、ネゴシエーション、要求対応、タイムアウト、キャンセル、再接続を小さな公開APIの内側に隠します。",
  "landing.pairingNote":
    "ブラウザが接続を申請し、利用者がローカルBridgeで正確なOriginを承認します。ブラウザ側のトークン入力は不要です。",
  "landing.sourceDocs": "出典に基づくドキュメント",
  "landing.docsTitle": "開発者と開発エージェントのために。",
  "landing.docsText":
    "表示ドキュメントとDocs MCPは、横断検索、API・型検索、例、トラブルシューティング、状態、出典、関連情報を含む同じ型付きコーパスを共有します。",
  "landing.exploreDocs": "{count}件のドキュメント領域を見る",
  "docs.navigation": "ドキュメントナビゲーション",
  "docs.documentation": "ドキュメント",
  "docs.areas": "{count}領域",
  "docs.kicker": "BrowserMCPドキュメント",
  "docs.title": "ブラウザをランタイムにして開発する。",
  "docs.lede":
    "概念、責務、APIと型、例、設定、プロトコル、セキュリティ制約、診断を、ひとつの構造化コーパスから検索できます。",
  "docs.pages": "{count}ページ",
  "docs.sections": "{count}セクション",
  "docs.implemented": "実装済み {count}",
  "docs.planned": "計画中 {count}",
  "docs.constraints": "制約 {count}",
  "docs.searchLabel": "BrowserMCPドキュメントを検索",
  "docs.searchPlaceholder": "セットアップ、app.tool、Originエラー、競合を検索…",
  "docs.searchHint":
    "構造化インデックスを検索します。結果には状態、出典、ページとセクション、コード、関連資料が含まれます。",
  "docs.noResults":
    "一致するセクションがありません。責務、API名、エラー、作業内容を試してください。",
  "docs.areasLabel": "ドキュメント領域",
  "docs.sectionCount": "{count}セクション →",
  "docs.onThisPage": "このページの内容",
  "docs.onThisPageLabel": "ページ内ナビゲーション",
  "docs.adjacent": "前後のドキュメントページ",
  "docs.backToIndex": "ドキュメント一覧へ戻る →",
  "connection.siteRuntime": "BrowserMCPサイトランタイム",
  "connection.title": "接続とセッションの状態",
  "connection.lede":
    "このサイト全体が1つのBrowserMCPアプリです。ページの正確なOriginで承認を申請してブラウザセッションを確立し、登録されたTool、Resource、Prompt、呼び出し、結果、安全なエラーを確認できます。",
  "connection.transport": "通信",
  "connection.session": "セッション",
  "connection.registrations": "登録機能",
  "connection.localAccess": "ローカルアクセス",
  "connection.noSession": "有効なセッションIDはありません",
  "connection.capabilityKinds": "Tool、Resource、Prompt",
  "connection.healthHint": "資格情報不要の/health確認を実行",
  "connection.explicitPairing": "明示的なOrigin承認",
  "connection.connectTitle": "共通ローカルBridgeへ接続を申請",
  "connection.connectText":
    "静的ホストを含むすべての公開HTTPSページでは、信頼済みローカル証明書とWSSを使用します。ローカルHTTP開発では127.0.0.1上のWSを利用できます。Bridgeはloopback URLだけを受け付けます。",
  "connection.bridgeUrl": "Bridge WebSocket URL",
  "connection.connect": "承認を申請",
  "connection.checkAccess": "ローカルアクセスを確認",
  "connection.reconnect": "再接続",
  "connection.disconnect": "切断",
  "connection.tokenNote":
    "ブラウザは正確なOriginとアプリ識別情報を送信します。Bridge管理画面で保留中の申請を承認してください。この静的ページは承認トークンを受け取りも保存もしません。",
  "connection.approvalPending":
    "このタブを開いたまま、Bridge管理画面で正確なOriginとアプリ識別情報を確認し、ApproveまたはRejectを選択してください。",
  "connection.readiness": "安全なページの準備状況",
  "connection.fourChecks": "承認前の4項目",
  "connection.troubleshooting": "トラブルシューティングを開く",
  "connection.recentError": "直近の接続エラー",
  "connection.diagnosticOrder": "診断手順を確認",
  "connection.liveSnapshot": "機能のライブスナップショット",
  "connection.registeredHere": "このサイトランタイムに登録済み",
  "connection.tools": "Tool",
  "connection.resources": "Resource",
  "connection.prompts": "Prompt",
  "connection.noRegistrations": "登録された機能はありません。",
  "connection.requests": "要求",
  "connection.recentExecutions": "最近のブラウザ実行",
  "connection.noExecutions": "このタブではまだブラウザ呼び出しが完了していません。",
  "connection.outcome": "結果",
  "connection.latest": "最新結果と安全なログ",
  "connection.noResult": "記録された結果はありません。",
  "connection.noEvents": "診断イベントはまだありません。",
  "connection.diagnosticTransport": "loopback通信",
  "connection.diagnosticTransportReady": "{endpoint} はloopback限定エンドポイントです。",
  "connection.diagnosticCertificate": "信頼済みローカル証明書",
  "connection.diagnosticCertificateSecure":
    "WebSocket接続の前に、ブラウザがBridgeのlocalhost証明書を信頼している必要があります。",
  "connection.diagnosticCertificateDevelopment":
    "ローカルHTTP開発ではTLSを使用しません。公開HTTPSページではWSSが必要です。",
  "connection.diagnosticCertificateAction":
    "生成したローカルCAを明示的に信頼し、https://{host}/health を開いてください。証明書警告を回避してはいけません。",
  "connection.diagnosticOrigin": "厳密なOrigin承認",
  "connection.diagnosticOriginDetail":
    "{origin} を正確に承認してください。scheme、host、portは区別されます。",
  "connection.diagnosticOriginAction":
    "ここで接続を申請し、Bridge管理画面でこの正確なOriginを承認してください。",
  "connection.diagnosticNetwork": "ローカルネットワーク権限",
  "connection.diagnosticNetworkDetail":
    "Chrome 142はfetch系loopback要求を制限し、Chrome 147はLNA権限をWebSocketまで拡張します。",
  "connection.diagnosticNetworkAction":
    "要求された場合はloopbackアクセスを許可し、Bridgeのhealth応答がこのOriginを許可することを確認してください。",
};

const coreMessages: Readonly<Record<string, MessageOverrides>> = {
  "zh-CN": {
    "common.skip": "跳转到正文",
    "common.language": "语言",
    "common.languageSelect": "选择显示语言",
    "common.overview": "概览",
    "common.docs": "文档",
    "common.connection": "连接",
    "common.architecture": "架构",
    "common.security": "安全",
    "common.development": "开发",
    "common.roadmap": "路线图",
    "common.tagline": "浏览器就是 MCP 运行时。",
    "common.bridgeConnected": "Bridge 已连接",
    "landing.heroBefore": "浏览器就是 ",
    "landing.heroHighlight": "MCP 运行时。",
    "landing.lede":
      "通过一个安全的本地 Bridge，公开 Web 应用中已有的 JavaScript、Worker、WASM、IndexedDB、Canvas 和 Web API 逻辑。",
    "landing.readDocs": "阅读文档",
    "landing.connectBridge": "连接 Bridge",
    "landing.architectureTitle": "一项客户端配置，连接任何已配对的 Web 应用。",
    "landing.why": "为什么选择 BrowserMCP",
    "landing.contextTitle": "让执行留在上下文所在之处。",
    "landing.minimal": "最小应用",
    "landing.declareTitle": "声明浏览器能力，只需连接一次。",
    "landing.sourceDocs": "有来源依据的文档",
    "landing.docsTitle": "为开发者和开发智能体而构建。",
    "landing.exploreDocs": "浏览 {count} 个文档领域",
    "docs.documentation": "文档",
    "docs.areas": "{count} 个领域",
    "docs.kicker": "BrowserMCP 文档",
    "docs.title": "以浏览器作为运行时进行开发。",
    "docs.searchLabel": "搜索 BrowserMCP 文档",
    "docs.searchPlaceholder": "搜索设置、app.tool、Origin 错误、冲突…",
    "docs.noResults": "没有匹配的章节。请尝试职责、API 名称、错误或任务。",
    "docs.onThisPage": "本页内容",
    "docs.backToIndex": "返回文档索引 →",
    "connection.title": "连接与会话状态",
    "connection.transport": "传输",
    "connection.session": "会话",
    "connection.registrations": "注册项",
    "connection.localAccess": "本地访问",
    "connection.connectTitle": "向通用本地 Bridge 申请访问",
    "connection.connect": "申请批准",
    "connection.checkAccess": "检查本地访问",
    "connection.reconnect": "重新连接",
    "connection.disconnect": "断开连接",
    "connection.troubleshooting": "打开故障排除",
    "connection.recentExecutions": "最近的浏览器执行",
    "connection.latest": "最新结果与安全日志",
  },
  es: {
    "common.skip": "Ir al contenido",
    "common.language": "Idioma",
    "common.languageSelect": "Seleccionar idioma",
    "common.overview": "Resumen",
    "common.docs": "Documentación",
    "common.connection": "Conexión",
    "common.architecture": "Arquitectura",
    "common.security": "Seguridad",
    "common.development": "Desarrollo",
    "common.roadmap": "Hoja de ruta",
    "common.tagline": "El navegador es el entorno de ejecución MCP.",
    "common.bridgeConnected": "Bridge conectado",
    "landing.heroBefore": "El navegador es el ",
    "landing.heroHighlight": "entorno MCP.",
    "landing.lede":
      "Expone mediante un Bridge local seguro la lógica que ya vive en una aplicación web: JavaScript, Workers, WASM, IndexedDB, Canvas y APIs web.",
    "landing.readDocs": "Leer la documentación",
    "landing.connectBridge": "Conectar el Bridge",
    "landing.architectureTitle":
      "Una configuración de cliente. Cualquier aplicación web emparejada.",
    "landing.why": "Por qué BrowserMCP",
    "landing.contextTitle": "Ejecuta donde vive el contexto.",
    "landing.minimal": "Aplicación mínima",
    "landing.declareTitle": "Declara una capacidad del navegador. Conecta una vez.",
    "landing.sourceDocs": "Documentación con fuentes",
    "landing.docsTitle": "Creado para desarrolladores y agentes de desarrollo.",
    "landing.exploreDocs": "Explorar {count} áreas de documentación",
    "docs.documentation": "Documentación",
    "docs.areas": "{count} áreas",
    "docs.kicker": "Documentación de BrowserMCP",
    "docs.title": "Desarrolla con el navegador como entorno de ejecución.",
    "docs.searchLabel": "Buscar en la documentación de BrowserMCP",
    "docs.searchPlaceholder": "Buscar configuración, app.tool, errores de Origin, colisiones…",
    "docs.noResults": "Ninguna sección coincide. Prueba una responsabilidad, API, error o tarea.",
    "docs.onThisPage": "En esta página",
    "docs.backToIndex": "Volver al índice →",
    "connection.title": "Estado de conexión y sesión",
    "connection.transport": "Transporte",
    "connection.session": "Sesión",
    "connection.registrations": "Registros",
    "connection.localAccess": "Acceso local",
    "connection.connectTitle": "Solicitar acceso al Bridge local común",
    "connection.connect": "Solicitar aprobación",
    "connection.checkAccess": "Comprobar acceso local",
    "connection.reconnect": "Reconectar",
    "connection.disconnect": "Desconectar",
    "connection.troubleshooting": "Abrir solución de problemas",
    "connection.recentExecutions": "Ejecuciones recientes del navegador",
    "connection.latest": "Último resultado y registros seguros",
  },
  hi: {
    "common.skip": "मुख्य सामग्री पर जाएँ",
    "common.language": "भाषा",
    "common.languageSelect": "प्रदर्शन भाषा चुनें",
    "common.overview": "परिचय",
    "common.docs": "दस्तावेज़",
    "common.connection": "कनेक्शन",
    "common.architecture": "आर्किटेक्चर",
    "common.security": "सुरक्षा",
    "common.development": "विकास",
    "common.roadmap": "रोडमैप",
    "common.tagline": "ब्राउज़र ही MCP रनटाइम है।",
    "common.bridgeConnected": "Bridge जुड़ा है",
    "landing.heroBefore": "ब्राउज़र ही ",
    "landing.heroHighlight": "MCP रनटाइम है।",
    "landing.lede":
      "वेब ऐप में पहले से मौजूद JavaScript, Workers, WASM, IndexedDB, Canvas और Web API लॉजिक को एक सुरक्षित स्थानीय Bridge से उपलब्ध कराएँ।",
    "landing.readDocs": "दस्तावेज़ पढ़ें",
    "landing.connectBridge": "Bridge कनेक्ट करें",
    "landing.architectureTitle": "एक क्लाइंट कॉन्फ़िगरेशन। कोई भी जोड़ा गया वेब ऐप।",
    "landing.why": "BrowserMCP क्यों",
    "landing.contextTitle": "जहाँ संदर्भ है, वहीं निष्पादन रखें।",
    "landing.minimal": "न्यूनतम ऐप",
    "landing.declareTitle": "ब्राउज़र क्षमता घोषित करें। एक बार कनेक्ट करें।",
    "landing.sourceDocs": "स्रोत-आधारित दस्तावेज़",
    "landing.docsTitle": "डेवलपर और डेवलपमेंट एजेंट के लिए।",
    "landing.exploreDocs": "{count} दस्तावेज़ क्षेत्र देखें",
    "docs.documentation": "दस्तावेज़",
    "docs.areas": "{count} क्षेत्र",
    "docs.kicker": "BrowserMCP दस्तावेज़",
    "docs.title": "ब्राउज़र को रनटाइम बनाकर विकसित करें।",
    "docs.searchLabel": "BrowserMCP दस्तावेज़ खोजें",
    "docs.searchPlaceholder": "सेटअप, app.tool, Origin त्रुटि, टकराव खोजें…",
    "docs.noResults": "कोई अनुभाग नहीं मिला। जिम्मेदारी, API नाम, त्रुटि या कार्य आज़माएँ।",
    "docs.onThisPage": "इस पृष्ठ पर",
    "docs.backToIndex": "दस्तावेज़ सूची पर लौटें →",
    "connection.title": "कनेक्शन और सत्र स्थिति",
    "connection.transport": "ट्रांसपोर्ट",
    "connection.session": "सत्र",
    "connection.registrations": "पंजीकरण",
    "connection.localAccess": "स्थानीय पहुँच",
    "connection.connectTitle": "साझा स्थानीय Bridge से पहुँच माँगें",
    "connection.connect": "मंज़ूरी माँगें",
    "connection.checkAccess": "स्थानीय पहुँच जाँचें",
    "connection.reconnect": "फिर कनेक्ट करें",
    "connection.disconnect": "डिस्कनेक्ट करें",
    "connection.troubleshooting": "समस्या निवारण खोलें",
    "connection.recentExecutions": "हाल के ब्राउज़र निष्पादन",
    "connection.latest": "नवीनतम परिणाम और सुरक्षित लॉग",
  },
  ar: {
    "common.skip": "الانتقال إلى المحتوى",
    "common.language": "اللغة",
    "common.languageSelect": "اختيار لغة العرض",
    "common.overview": "نظرة عامة",
    "common.docs": "التوثيق",
    "common.connection": "الاتصال",
    "common.architecture": "البنية",
    "common.security": "الأمان",
    "common.development": "التطوير",
    "common.roadmap": "خارطة الطريق",
    "common.tagline": "المتصفح هو بيئة تشغيل MCP.",
    "common.bridgeConnected": "Bridge متصل",
    "landing.heroBefore": "المتصفح هو ",
    "landing.heroHighlight": "بيئة تشغيل MCP.",
    "landing.lede":
      "اعرض منطق JavaScript وWorkers وWASM وIndexedDB وCanvas وواجهات الويب الموجود في التطبيق عبر Bridge محلي آمن واحد.",
    "landing.readDocs": "قراءة التوثيق",
    "landing.connectBridge": "اتصال بـ Bridge",
    "landing.architectureTitle": "إعداد عميل واحد لأي تطبيق ويب مقترن.",
    "landing.why": "لماذا BrowserMCP",
    "landing.contextTitle": "أبقِ التنفيذ حيث يوجد السياق.",
    "landing.minimal": "تطبيق بسيط",
    "landing.declareTitle": "عرّف قدرة للمتصفح واتصل مرة واحدة.",
    "landing.sourceDocs": "توثيق مستند إلى المصادر",
    "landing.docsTitle": "مصمم للمطورين ووكلاء التطوير.",
    "landing.exploreDocs": "استكشف {count} مجالاً في التوثيق",
    "docs.documentation": "التوثيق",
    "docs.areas": "{count} مجالات",
    "docs.kicker": "توثيق BrowserMCP",
    "docs.title": "طوّر باستخدام المتصفح كبيئة تشغيل.",
    "docs.searchLabel": "البحث في توثيق BrowserMCP",
    "docs.searchPlaceholder": "ابحث عن الإعداد وapp.tool وأخطاء Origin والتعارضات…",
    "docs.noResults": "لا يوجد قسم مطابق. جرّب مسؤولية أو اسم API أو خطأ أو مهمة.",
    "docs.onThisPage": "في هذه الصفحة",
    "docs.backToIndex": "العودة إلى فهرس التوثيق ←",
    "connection.title": "حالة الاتصال والجلسة",
    "connection.transport": "النقل",
    "connection.session": "الجلسة",
    "connection.registrations": "التسجيلات",
    "connection.localAccess": "الوصول المحلي",
    "connection.connectTitle": "طلب الوصول من Bridge المحلي المشترك",
    "connection.connect": "طلب الموافقة",
    "connection.checkAccess": "فحص الوصول المحلي",
    "connection.reconnect": "إعادة الاتصال",
    "connection.disconnect": "قطع الاتصال",
    "connection.troubleshooting": "فتح استكشاف الأخطاء",
    "connection.recentExecutions": "عمليات المتصفح الأخيرة",
    "connection.latest": "أحدث نتيجة وسجلات آمنة",
  },
  "pt-BR": {
    "common.skip": "Ir para o conteúdo",
    "common.language": "Idioma",
    "common.languageSelect": "Selecionar idioma",
    "common.overview": "Visão geral",
    "common.docs": "Documentação",
    "common.connection": "Conexão",
    "common.architecture": "Arquitetura",
    "common.security": "Segurança",
    "common.development": "Desenvolvimento",
    "common.roadmap": "Roteiro",
    "common.tagline": "O navegador é o runtime MCP.",
    "common.bridgeConnected": "Bridge conectado",
    "landing.heroBefore": "O navegador é o ",
    "landing.heroHighlight": "runtime MCP.",
    "landing.lede":
      "Exponha por um Bridge local seguro a lógica que já vive no app web: JavaScript, Workers, WASM, IndexedDB, Canvas e APIs Web.",
    "landing.readDocs": "Ler a documentação",
    "landing.connectBridge": "Conectar o Bridge",
    "landing.architectureTitle": "Uma configuração de cliente. Qualquer app web pareado.",
    "landing.why": "Por que BrowserMCP",
    "landing.contextTitle": "Execute onde o contexto está.",
    "landing.minimal": "App mínimo",
    "landing.declareTitle": "Declare um recurso do navegador. Conecte uma vez.",
    "landing.sourceDocs": "Documentação com fontes",
    "landing.docsTitle": "Feito para desenvolvedores e agentes de desenvolvimento.",
    "landing.exploreDocs": "Explorar {count} áreas da documentação",
    "docs.documentation": "Documentação",
    "docs.areas": "{count} áreas",
    "docs.kicker": "Documentação do BrowserMCP",
    "docs.title": "Desenvolva com o navegador como runtime.",
    "docs.searchLabel": "Pesquisar na documentação do BrowserMCP",
    "docs.searchPlaceholder": "Pesquisar configuração, app.tool, erros de Origin, colisões…",
    "docs.noResults": "Nenhuma seção corresponde. Tente responsabilidade, API, erro ou tarefa.",
    "docs.onThisPage": "Nesta página",
    "docs.backToIndex": "Voltar ao índice →",
    "connection.title": "Status da conexão e sessão",
    "connection.transport": "Transporte",
    "connection.session": "Sessão",
    "connection.registrations": "Registros",
    "connection.localAccess": "Acesso local",
    "connection.connectTitle": "Solicitar acesso ao Bridge local comum",
    "connection.connect": "Solicitar aprovação",
    "connection.checkAccess": "Verificar acesso local",
    "connection.reconnect": "Reconectar",
    "connection.disconnect": "Desconectar",
    "connection.troubleshooting": "Abrir solução de problemas",
    "connection.recentExecutions": "Execuções recentes do navegador",
    "connection.latest": "Resultado mais recente e logs seguros",
  },
  bn: {
    "common.skip": "মূল বিষয়বস্তুতে যান",
    "common.language": "ভাষা",
    "common.languageSelect": "প্রদর্শনের ভাষা বেছে নিন",
    "common.overview": "সংক্ষিপ্ত বিবরণ",
    "common.docs": "ডকুমেন্টেশন",
    "common.connection": "সংযোগ",
    "common.architecture": "আর্কিটেকচার",
    "common.security": "নিরাপত্তা",
    "common.development": "ডেভেলপমেন্ট",
    "common.roadmap": "রোডম্যাপ",
    "common.tagline": "ব্রাউজারই MCP রানটাইম।",
    "common.bridgeConnected": "Bridge সংযুক্ত",
    "landing.heroBefore": "ব্রাউজারই ",
    "landing.heroHighlight": "MCP রানটাইম।",
    "landing.lede":
      "ওয়েব অ্যাপে থাকা JavaScript, Workers, WASM, IndexedDB, Canvas ও Web API লজিক একটি নিরাপদ স্থানীয় Bridge দিয়ে প্রকাশ করুন।",
    "landing.readDocs": "ডকুমেন্টেশন পড়ুন",
    "landing.connectBridge": "Bridge সংযুক্ত করুন",
    "landing.architectureTitle": "একটি ক্লায়েন্ট কনফিগারেশন। যেকোনো পেয়ার করা ওয়েব অ্যাপ।",
    "landing.why": "কেন BrowserMCP",
    "landing.contextTitle": "যেখানে প্রসঙ্গ আছে, সেখানেই চালান।",
    "landing.minimal": "ন্যূনতম অ্যাপ",
    "landing.declareTitle": "ব্রাউজার সক্ষমতা ঘোষণা করুন। একবার সংযুক্ত করুন।",
    "landing.sourceDocs": "উৎস-সমর্থিত ডকুমেন্টেশন",
    "landing.docsTitle": "ডেভেলপার ও ডেভেলপমেন্ট এজেন্টদের জন্য।",
    "landing.exploreDocs": "{count}টি ডকুমেন্টেশন ক্ষেত্র দেখুন",
    "docs.documentation": "ডকুমেন্টেশন",
    "docs.areas": "{count}টি ক্ষেত্র",
    "docs.kicker": "BrowserMCP ডকুমেন্টেশন",
    "docs.title": "ব্রাউজারকে রানটাইম করে তৈরি করুন।",
    "docs.searchLabel": "BrowserMCP ডকুমেন্টেশন খুঁজুন",
    "docs.searchPlaceholder": "সেটআপ, app.tool, Origin ত্রুটি, সংঘর্ষ খুঁজুন…",
    "docs.noResults": "কোনো বিভাগ মেলেনি। দায়িত্ব, API নাম, ত্রুটি বা কাজ চেষ্টা করুন।",
    "docs.onThisPage": "এই পৃষ্ঠায়",
    "docs.backToIndex": "ডকুমেন্টেশন সূচিতে ফিরুন →",
    "connection.title": "সংযোগ ও সেশনের অবস্থা",
    "connection.transport": "ট্রান্সপোর্ট",
    "connection.session": "সেশন",
    "connection.registrations": "রেজিস্ট্রেশন",
    "connection.localAccess": "স্থানীয় অ্যাক্সেস",
    "connection.connectTitle": "সাধারণ স্থানীয় Bridge-এ অ্যাক্সেস অনুরোধ করুন",
    "connection.connect": "অনুমোদন চান",
    "connection.checkAccess": "স্থানীয় অ্যাক্সেস যাচাই",
    "connection.reconnect": "পুনরায় সংযোগ",
    "connection.disconnect": "সংযোগ বিচ্ছিন্ন",
    "connection.troubleshooting": "সমস্যা সমাধান খুলুন",
    "connection.recentExecutions": "সাম্প্রতিক ব্রাউজার এক্সিকিউশন",
    "connection.latest": "সর্বশেষ ফলাফল ও নিরাপদ লগ",
  },
  ru: {
    "common.skip": "Перейти к содержимому",
    "common.language": "Язык",
    "common.languageSelect": "Выбрать язык интерфейса",
    "common.overview": "Обзор",
    "common.docs": "Документация",
    "common.connection": "Подключение",
    "common.architecture": "Архитектура",
    "common.security": "Безопасность",
    "common.development": "Разработка",
    "common.roadmap": "Планы",
    "common.tagline": "Браузер — это среда выполнения MCP.",
    "common.bridgeConnected": "Bridge подключён",
    "landing.heroBefore": "Браузер — это ",
    "landing.heroHighlight": "среда MCP.",
    "landing.lede":
      "Предоставьте через один безопасный локальный Bridge уже существующую в веб-приложении логику JavaScript, Workers, WASM, IndexedDB, Canvas и Web API.",
    "landing.readDocs": "Читать документацию",
    "landing.connectBridge": "Подключить Bridge",
    "landing.architectureTitle": "Одна настройка клиента. Любое сопряжённое веб-приложение.",
    "landing.why": "Почему BrowserMCP",
    "landing.contextTitle": "Выполняйте там, где находится контекст.",
    "landing.minimal": "Минимальное приложение",
    "landing.declareTitle": "Объявите возможность браузера. Подключитесь один раз.",
    "landing.sourceDocs": "Документация с источниками",
    "landing.docsTitle": "Для разработчиков и агентов разработки.",
    "landing.exploreDocs": "Открыть {count} разделов документации",
    "docs.documentation": "Документация",
    "docs.areas": "Разделов: {count}",
    "docs.kicker": "Документация BrowserMCP",
    "docs.title": "Разрабатывайте с браузером в роли среды выполнения.",
    "docs.searchLabel": "Поиск в документации BrowserMCP",
    "docs.searchPlaceholder": "Искать настройку, app.tool, ошибки Origin, конфликты…",
    "docs.noResults": "Совпадений нет. Попробуйте ответственность, API, ошибку или задачу.",
    "docs.onThisPage": "На этой странице",
    "docs.backToIndex": "Вернуться к списку →",
    "connection.title": "Состояние подключения и сеанса",
    "connection.transport": "Транспорт",
    "connection.session": "Сеанс",
    "connection.registrations": "Регистрации",
    "connection.localAccess": "Локальный доступ",
    "connection.connectTitle": "Запросить доступ у общего локального Bridge",
    "connection.connect": "Запросить одобрение",
    "connection.checkAccess": "Проверить локальный доступ",
    "connection.reconnect": "Переподключить",
    "connection.disconnect": "Отключить",
    "connection.troubleshooting": "Открыть диагностику",
    "connection.recentExecutions": "Недавние выполнения в браузере",
    "connection.latest": "Последний результат и безопасные журналы",
  },
};

const overrides = Object.fromEntries(
  SUPPORTED_LOCALES.map((locale) => {
    if (locale === "en") return [locale, {}];
    if (locale === "ja") return [locale, japaneseMessages];
    return [
      locale,
      {
        ...fullUiMessageOverrides[locale],
        ...coreMessages[locale],
      },
    ];
  }),
) as unknown as Record<SupportedLocale, MessageOverrides>;

const localeSet = new Set<string>(SUPPORTED_LOCALES);
const STORAGE_KEY = "browsermcp.site.locale.v1";

const localeAliases: Readonly<Record<string, SupportedLocale>> = {
  en: "en",
  ja: "ja",
  zh: "zh-CN",
  "zh-cn": "zh-CN",
  "zh-hans": "zh-CN",
  "zh-sg": "zh-CN",
  es: "es",
  hi: "hi",
  ar: "ar",
  pt: "pt-BR",
  "pt-br": "pt-BR",
  bn: "bn",
  ru: "ru",
};

export const resolveLocale = (languages: readonly string[]): SupportedLocale => {
  for (const candidate of languages) {
    const normalized = candidate.trim().toLocaleLowerCase("en-US");
    const direct = localeAliases[normalized];
    if (direct !== undefined) return direct;
    const primary = normalized.split("-")[0];
    if (primary !== undefined) {
      const aliased = localeAliases[primary];
      if (aliased !== undefined) return aliased;
    }
  }
  return "en";
};

export const isSupportedLocale = (value: string): value is SupportedLocale => localeSet.has(value);

export const loadLocale = (
  storage: Pick<Storage, "getItem"> | undefined,
  languages: readonly string[],
): SupportedLocale => {
  try {
    const stored = storage?.getItem(STORAGE_KEY);
    if (stored !== null && stored !== undefined && isSupportedLocale(stored)) return stored;
  } catch {
    // Browser privacy modes can deny storage. Locale detection remains fully functional.
  }
  return resolveLocale(languages);
};

export const saveLocale = (
  locale: SupportedLocale,
  storage: Pick<Storage, "setItem"> | undefined,
): void => {
  try {
    storage?.setItem(STORAGE_KEY, locale);
  } catch {
    // Language selection still applies to the current tab when storage is unavailable.
  }
};

export interface Translator {
  readonly locale: SupportedLocale;
  readonly direction: TextDirection;
  t: (key: MessageKey, values?: Readonly<Record<string, string | number>>) => string;
  number: (value: number) => string;
  time: (value: number | Date) => string;
}

const interpolate = (
  template: string,
  values: Readonly<Record<string, string | number>> | undefined,
): string =>
  template.replace(/\{([a-z][a-zA-Z0-9]*)\}/gu, (match, name: string) => {
    const value = values?.[name];
    return value === undefined ? match : String(value);
  });

export const createTranslator = (locale: SupportedLocale): Translator => {
  const definition = localeDefinitions.find((candidate) => candidate.locale === locale);
  const messages = overrides[locale];
  const numberFormat = new Intl.NumberFormat(locale);
  const timeFormat = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return {
    locale,
    direction: definition?.direction ?? "ltr",
    t: (key, values) => interpolate(messages[key] ?? englishMessages[key], values),
    number: (value) => numberFormat.format(value),
    time: (value) => timeFormat.format(value),
  };
};

export const applyDocumentLocale = (translator: Translator): void => {
  document.documentElement.lang = translator.locale;
  document.documentElement.dir = translator.direction;
  document.querySelector<HTMLElement>(".skip-link")?.replaceChildren(translator.t("common.skip"));
  document
    .querySelector<HTMLMetaElement>('meta[name="description"]')
    ?.setAttribute("content", translator.t("landing.lede"));
};

export const localeStorageKey = STORAGE_KEY;

export const missingTranslationKeys = (locale: SupportedLocale): readonly MessageKey[] =>
  locale === "en"
    ? []
    : (Object.keys(englishMessages) as MessageKey[]).filter(
        (key) => overrides[locale][key] === undefined,
      );

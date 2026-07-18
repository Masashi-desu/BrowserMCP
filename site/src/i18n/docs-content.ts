import type { DocPage, DocSection } from "../docs/schema.js";
import type { SupportedLocale } from "./index.js";

export interface LocalizedDocSection {
  readonly title: string;
  readonly body: string;
}

export interface LocalizedDocPage {
  readonly title: string;
  readonly description: string;
  readonly sections: Readonly<Record<string, LocalizedDocSection>>;
}

interface LocaleCatalog {
  readonly pageDescriptions: Readonly<Record<string, string>>;
  readonly sections: Readonly<Record<string, LocalizedDocSection>>;
}

const parseRows = (source: string): Readonly<Record<string, readonly string[]>> =>
  Object.fromEntries(
    source
      .trim()
      .split("\n")
      .map((row) => row.split("|"))
      .map(([key, ...values]) => {
        if (key === undefined || key.length === 0 || values.some((value) => value === undefined)) {
          throw new Error("Invalid localized documentation row");
        }
        return [key, values] as const;
      }),
  );

const catalog = (pageRows: string, sectionRows: string): LocaleCatalog => ({
  pageDescriptions: Object.fromEntries(
    Object.entries(parseRows(pageRows)).map(([key, values]) => [key, values[0] ?? ""]),
  ),
  sections: Object.fromEntries(
    Object.entries(parseRows(sectionRows)).map(([key, values]) => [
      key,
      { title: values[0] ?? "", body: values[1] ?? "" },
    ]),
  ),
});

const ja = catalog(
  `introduction|BrowserMCPがブラウザをMCPランタイムとして利用する理由を説明します。
architecture|構成要素、信頼境界、要求のルーティングを説明します。
getting-started|チェックアウトから最初のブラウザ機能を呼び出すまでの最短手順です。
installing-macos-bridge|共通Bridgeを直接実行する方法と、macOSネイティブアプリで管理する方法を説明します。
configuring-mcp-client|接続中のすべてのブラウザアプリに対して、Streamable HTTPエンドポイントを1件だけ登録します。
creating-app|フレームワーク非依存のWebライブラリを追加し、ブラウザ機能を宣言します。
tools|ブラウザで実行される、スキーマ付きの操作を登録します。
resources|実行を伴わない、アドレス指定可能なブラウザおよびドキュメントの内容を公開します。
prompts|引数に応じて再利用できる開発ワークフローを公開します。
results-errors|成功結果、実行失敗、通信エラー、タイムアウト、キャンセルを説明します。
connection-lifecycle|ペアリング、セッション確立、機能同期、再接続、終了処理を説明します。
bridge-protocol|Bridgeとブラウザ間で使用する、型付きかつバージョン管理された内部プロトコルです。
security-model|信頼境界、Originに結び付くペアリング、上限、検証、秘密情報の扱いを説明します。
multiple-applications|識別情報、名前空間、複数タブ、競合処理、決定的ルーティングを説明します。
api-reference|Webアプリが利用するBrowserMCPの公開APIと型のリファレンスです。
bridge-configuration|loopbackエンドポイント、Origin方針、上限、ログ、運用上の既定値を説明します。
troubleshooting|接続、Origin、認証、バージョン、ルーティングの問題を証拠に基づいて診断します。
development|ワークスペース構成、サイト設計、品質ゲート、コントリビューション境界を説明します。
roadmap|実装済み範囲、計画中の作業、既知の制約を示します。`,
  `introduction/problem|BrowserMCPが解決する課題|実際のロジック、データ、利用者コンテキストがWebアプリにある場合でも、MCP連携は別サーバーとして実装されがちです。BrowserMCPは実行をブラウザに残し、アプリ固有の業務ロジックをBridgeへ持ち込まずに、接続中のWebアプリの機能を共通BridgeからMCPクライアントへ公開します。
introduction/browser-runtime|ブラウザがMCPランタイムになる|ハンドラーは接続中のページ内で動くため、JavaScript、Worker、WASM、IndexedDB、CanvasなどサーバープロセスにはないWeb APIを利用できます。Bridgeは認証とルーティングだけを担い、ブラウザ所有の実装をローカルBridgeやネイティブアプリへ移しません。
introduction/one-client-entry|MCPクライアント設定は1件|MCPクライアントはStreamable HTTPでhttp://127.0.0.1:8789/mcpへ接続し、接続中アプリの名前空間付き機能を1つのエンドポイントから検出します。loopbackだけを信頼境界とせず、新規ブラウザ接続は正確なOriginについて利用者の明示的承認を必要とします。
architecture/components|コアコンポーネントと任意のmacOSシェル|MCPクライアントは標準MCP Streamable HTTPを使用し、クロスプラットフォームのNode.js Bridgeが標準MCP操作を別のBrowserMCP Bridge Protocolへ変換します。protocol packageはwire型、web packageはブラウザ接続状態、各WebアプリはTool、Resource、Prompt、データ、Web API利用を所有します。macOSアプリは同じBridgeプロセスを管理するだけです。
architecture/responsibility-boundaries|責務境界|Bridgeはloopback待受、MCPセッション、認証、ルーティング、上限、キャンセル、タイムアウト、結果変換を所有します。ブラウザアプリは機能宣言、意味上の入力検証、画面コンテキスト、実行を所有し、MCPクライアントは利用者の意図と承認方針を所有します。アプリ固有の検索や保存、ワークフローをBridgeへ追加してはいけません。
architecture/request-flow|要求フロー|BridgeはMCP要求を受け、名前空間付き機能を1つのruntimeへ解決し、Bridge Protocolのrequest IDを生成してinvokeを転送します。Webライブラリは登録済みhandlerへdispatchし、結果または構造化実行エラーを返します。timeoutとcancelは境界を越えて伝播し、切断したruntimeの機能と完了不能な要求は除去されます。
getting-started/prerequisites|前提条件|共通BridgeにはNode.js 24以降、npm 11以降、IPv4 loopback、現在のブラウザ、Streamable HTTP対応MCPクライアントが必要です。公開HTTPS静的アプリにはブラウザが信頼するIP対応ローカル証明書も必要です。macOSアプリはmacOS 14以降とXcodeを要し、実機検証済みはApple Silicon macOSのみです。
getting-started/workspace-setup|ワークスペースを導入して検証する|repository rootでnpm installを実行し、npm run typecheck、npm test、npm run format:check、npm run buildで全workspaceを検証します。Docs siteはnpm run dev -w @browsermcp/siteでloopback上に起動でき、外部serviceやdeployは不要です。
getting-started/first-round-trip|最初の往復呼び出しを完了する|CLIまたはBrowserMCP.appでBridgeを開始し、siteから接続を申請します。認証済みBridge管理画面で正確なOriginとアプリ識別情報を承認し、MCP clientにはhttp://127.0.0.1:8789/mcpを設定します。Tool一覧とdocs_searchのsource path・section IDを確認します。
installing-macos-bridge/build|クロスプラットフォームBridgeをbuildして実行する|正本のBridgeは/bridgeにあるNode.js 24のローカルprocessです。npm run build:bridgeでbuildし、npm run start:bridgeで開始します。同じCLI、設定、loopback endpoint、PEM TLS入力、protocolをmacOS、Linux、Windowsで利用します。OS serviceや証明書trustは自動変更せず、実機検証済みはApple Silicon macOSのみです。
installing-macos-bridge/start|macOSネイティブアプリをbuildして利用する|BrowserMCPApp schemeをCODE_SIGNING_ALLOWED=NOでbuildすると、macOS 14以降のmenu bar appが同じBridge processを開始・停止・再起動できます。Node/Bridge選択、endpoint、明示的credential表示、保留中のexact-Origin承認とApprove/Reject、legacy token互換、件数、status page、log、errorを管理します。Node.js 24は外部runtimeで、秘密情報とprocess stateはmemoryだけに保持します。
installing-macos-bridge/pair-site|ブラウザOriginを承認する|Webページから申請し、認証済みBridge管理画面でscheme・host・portが完全一致するOriginとアプリ識別情報を確認してApproveまたはRejectします。承認前はsessionも登録もなく、Web側のtoken入力は不要です。--pair-originはlegacy互換経路です。
configuring-mcp-client/client-entry|共通Bridgeを追加する|browsermcpというMCP server entryを1件作成し、Streamable HTTPのhttp://127.0.0.1:8789/mcpと、Bridge起動ごとに一度だけ表示されるAuthorization: Bearer形式のMCP tokenを設定します。browser pairing tokenやadmin tokenとは別物で、Webアプリごとのentryは作らず、共有設定へcommitしません。
configuring-mcp-client/verify|初期化と機能検出を確認する|siteをpairした後にMCP sessionを再接続するか機能一覧を更新し、各runtimeの名前空間付きTool、Resource、Promptが表示されることを確認します。Bridgeが応答してもsite機能がなければ、client設定を変える前にBridgeのapp一覧とsiteの接続panelを調べます。
configuring-mcp-client/client-trust|クライアント側の承認|機能検出はMCP clientの承認方針を置き換えません。browser由来のdescriptionとresultはpaired Originからのdataとして扱い、影響のあるToolには利用者承認と入力上限を維持します。このsiteのToolはread-onlyまたはOrigin限定ですが、別siteは別namespaceで異なる動作を公開できます。
creating-app/minimal-app|アプリを作成して接続する|bundler projectへ@browsermcp/webを追加し、Web application runtimeごとにBrowserMCP instanceを1つ作ります。安定したapp identityとtab/reconnectを区別するruntime identityを使い、connect前にTool、Resource、Promptを登録します。後からの登録変更もBridgeへ同期されます。
creating-app/static-hosting|静的ホスティングを利用する|Web libraryはUI frameworkに依存せず、ViteなどでbundleするかESMとしてimportできます。専用backendなしにGitHub Pagesのrepository subpathを含む静的fileとして配信できます。remote appはHTTPS必須で、改ざん可能なHTTP Originはwss Bridgeでも拒否し、plain HTTPはlocalhost/127.0.0.1開発だけに限定します。
creating-app/registration-lifecycle|登録ライフサイクルを管理する|登録methodはid、ready、unregister()を持つRegistrationHandleを返します。接続中のacknowledgementが必要ならreadyを待ち、contextが無効になったらunregister()します。disconnectはruntime所有の全機能を除去します。local nameは安定させ、Bridgeのapp namespaceによって他appとの衝突を避けます。
tools/register-tool|Toolを登録する|app.toolはブラウザで実行する操作を宣言します。local name、description、閉じたJSON Schema、非同期handlerを与え、handler内でも意味上の制約を検証して標準MCP content itemを返します。descriptionには副作用とbrowser所有stateを明示し、Bridgeのtransport上限を業務ruleの代用にしません。
tools/tool-safety|安全なToolを設計する|string、array、objectへ実用的なJSON Schema上限を設定し、長時間処理ではAbortSignalを尊重し、retryの可能性があれば冪等性を優先します。pairing token、browser credential、cross-origin data、任意script実行を公開せず、browser APIがuser gestureを要求する場合は構造化errorで伝えます。
tools/site-tools|このsiteが公開するTool|siteはDocs検索・取得・実装支援・診断、現在page、構造、navigation、runtime/status、Origin限定IndexedDB storage、Web Worker text解析のToolを登録します。MCPからの任意navigationは意図的に除外し、storageのkey/valueとWorker入力にはsize上限があり、任意codeは実行しません。
resources/register-resource|Resourceを登録する|app.resourceはapplication URIで識別されるcontentを登録します。正確なMIME typeを付けたtextまたはbinary contentsを返し、state変更操作にResource readを使いません。live page stateを表す場合も、各readを新しいsnapshotとして扱います。
resources/site-resources|ドキュメントResource|browsermcp://docs/index、browsermcp://docs/page/{pageId}、browsermcp://docs/statusからpage ID、path、description、status、sectionを取得できます。browsermcp://site/current-pageとbrowsermcp://site/statusはlive routeと接続snapshotを返し、すべて同じ型付き英語正本コーパスに由来します。
resources/resource-errors|Resourceエラー|存在しないpageやsectionを空の成功contentとして返さず、関連候補付きの構造化not-found errorにします。所有runtimeが切断するとBridgeは登録を除去し、古いreadは別runtimeへ誤転送されずcapability unavailableとして失敗します。
prompts/register-prompt|Promptを登録する|app.promptはname、description、argument宣言、handlerを登録し、browser内でMCP prompt messageを生成します。argument長を検証し、値を実行codeではなくdataとして補間します。Promptは関連Tool/Resourceへ案内しますがpermissionを迂回しません。
prompts/site-prompts|このsiteが公開する開発支援Prompt|browsermcp_get_started、browsermcp_implement、browsermcp_diagnose、browsermcp_review_boundariesが環境別導入、機能実装、証拠収集型診断、責務境界reviewを支援します。自由形式要約ではなく構造化Docs Toolを使い、page/section pathを引用するようclientへ指示します。
prompts/prompt-safety|Promptの安全性|argumentは信頼できない入力のままで、出力は助言にすぎません。長さを制限し、利用者textとinstructionを区別し、pairing tokenや秘密をmessageへ含めません。Promptだけで副作用を承認できず、Tool実行は別MCP操作としてclient方針とhandler検証に従います。
results-errors/success-results|成功結果|Tool handlerはMCP content itemを含むresult objectを返し、人向けには短いtext、machine向けには対応時にstructuredContentを使います。ResourceとPromptは標準MCP result shapeを使い、Web libraryがBridge request IDと対応付けます。
results-errors/errors|実行エラーとprotocolエラー|想定handler失敗はinvalid messageやruntime不在と区別します。timeout/cancel以外の例外は、stackを出さず安全で長さ制限されたmessageを持つHANDLER_ERRORへ正規化します。不正envelope、非対応version、認証失敗、size超過、未知request IDはhandler dispatch前に拒否します。
results-errors/timeout-cancel|タイムアウトとキャンセル|Bridgeのdeadline超過やMCP clientのcancelはbrowserへ伝わり、Web libraryがhandlerのAbortSignalをabortして遅いresultを無視します。handlerはfetch、Worker job、loopでsignalを監視する必要があり、既に完了した副作用をcancelで巻き戻すことはできません。
connection-lifecycle/state-machine|接続状態機械|connectはWebSocketを開き、protocol versionとfeatureを交渉してawaiting-approvalへ進みます。Bridge管理者がexact Originを承認した後にだけsessionとcapability snapshotを公開し、connected状態のruntimeがinvokeを受けます。
connection-lifecycle/reconnect|安全に再接続する|再試行可能なnetwork切断には上限付きexponential backoffを使い、有効な間だけ既存session proofを提示します。期限切れ・拒否credentialは消去し、新しいsessionが必要な場合は利用者操作で再申請します。既定memory storeは同じinstance内だけでresumeし、永続storeはcredentialとruntime identityの安全を担います。
connection-lifecycle/disconnect|切断とクリーンアップ|明示disconnectは可能ならprotocol messageを送り、socketを閉じ、pending handlerをabortし、session限定credentialを消去してstate subscriberを更新します。Bridgeはそのruntimeの全機能だけを原子的に除去し、他tabやappの登録には影響しません。
bridge-protocol/separation|標準MCPから分離する|標準MCPはBridgeで終端します。内部wire protocolはraw MCPをtunnelせず、connect、authenticate、negotiate、register、invoke、result、execution error、cancel、heartbeat、disconnect等をBridge所有型で表します。この分離でMCP transport詳細をWeb app handlerから隠し、Bridgeを再利用可能にします。
bridge-protocol/envelope|envelopeと識別子|各messageはprotocol version、message kind、session context、上限付きpayloadを持ちます。handshakeはapp/Origin/runtime/instance/version/featuresを示し、requestは一意のrequest IDとcapability参照を持ち、result/errorはそのIDを一度だけ参照します。v1はunknown field、未知kind、必須field欠落、重複terminal response、size超過を拒否します。
bridge-protocol/handshake|handshakeとnegotiation|browserが対応versionとcapabilityを提示し、Bridgeは共通versionを選ぶか登録前に拒否します。v1.1のapprovalはcredentialなしでapproval_requiredを返し、exact Originの明示承認後にだけsessionと登録を作成します。v1.0はtoken/resumeの互換経路です。
bridge-protocol/validation|message検証|TypeScript型はcompile-time補助でありsecurity境界ではありません。両endpointがuntrusted JSONをruntime検証し、size・concurrency上限とstate順序を強制します。logは安全なerror code、kind、correlation IDだけを記録し、既知credentialやURL内credentialをredactし、handler result bodyは記録しません。
security-model/trust-boundaries|信頼境界|MCP client、local Bridge、browser Originは別のprincipalです。loopbackはLAN公開を防ぎますがlocal processや任意pageを認証しません。security principalはexact Originで、app/runtime/instance情報は自己申告routing metadataです。同一Originのcodeは同じ権限を持ち、MCP clientの呼出承認とappのargument検証も引き続き必要です。
security-model/pairing|Originに結び付く承認|browserはcredentialなしで申請し、Bridgeは短時間の待機requestとexact Originを認証済み管理画面に表示します。管理者がApproveするまでsessionや登録を作成せず、Rejectまたは期限切れで閉じます。OWNER.github.io配下の全projectは同じOriginを共有します。
security-model/input-limits|上限と拒否|BridgeとWeb libraryはpayload size、runtime単位concurrent request、deadline、cancelへ有限な上限を設け、appは各capabilityにさらに厳しいschema上限を追加します。未知kind、非互換version、未認証登録、未知capability、不正request ID、malformed JSONは推測で補わずfail closedします。
security-model/known-boundaries|既知のsecurity境界|capabilityはpage Originの権限で動き、そのOriginのbrowser storageへアクセスできますが、BrowserMCPはsame-origin policy、permission prompt、secure context、user gestureを迂回しません。paired Originのcode侵害は切断まで影響し、v0.1は個別revokeを持たないためtab切断・closeまたはBridge再起動でmemory上の権限を失効させます。
multiple-applications/identity|applicationとruntimeの識別|appはnamespace/routing用にapp ID、name、version、runtime ID、instance IDを自己申告し、WebSocketがbrowser認証済みprincipalであるexact Originを与えます。表示名やrouting tuple自体はsecurity identityではなく、resume tokenはpair後にOriginとtupleへ結合されます。相互に信頼しないappはOriginを分離します。
multiple-applications/namespacing|名前と競合|Bridge公開名にはapp namespaceが付くため、異なるappは同じlocal nameを登録できます。同じapp/Originの複数tabが同じcapabilityを提供するとambiguous targetとしてinvokeを拒否します。v0.1はinstance選択fieldを持たず、duplicate providerを閉じて再試行し、last-writer-winsは禁止します。
multiple-applications/runtime-selection|runtimeの選択と解除|descriptorはapp、Origin、runtime、instance metadataを保持しますが、標準MCP v0.1ではinstanceを明示選択できないためproviderは1件だけ必要です。target切断時に別instanceへ黙って再routingせずunavailableを返し、そのruntimeの機能とin-flight requestだけを原子的に除去します。
api-reference/browsermcp|BrowserMCP class|new BrowserMCPはdisconnectedなappを作り、tool/resource/promptが宣言登録、connectがnegotiationと認証、disconnectが停止、reconnectが上限付き再試行を開始します。UIはstateとdiagnostic eventを購読できますが、公開app APIと内部protocolを分離し、message内部へ依存しません。
api-reference/registration-types|Tool、Resource、Promptの定義|ToolDefinitionはname、description、inputSchema、handler、ResourceDefinitionはuri、name、任意description/mimeType、handler、PromptDefinitionはname、description、argument metadata、handlerを持ちます。name/URIは安定したapp-local identifierで、duplicate登録は上書きせず拒否されます。
api-reference/connection-types|接続型と診断型|BrowserMCPOptionsはbridgeUrl、identity、reconnect/timeoutと承認待ち上限、session store、任意LNA準備を指定します。ConnectOptionsは承認申請方針、任意legacy token、AbortSignal、試行単位LNA準備を持ちます。snapshotはawaiting-approvalと非secretの申請情報を含み、logはbounded・deep frozen/cloned・credential redactedでresult bodyを含みません。
api-reference/protocol-types|protocol型は内部API|@browsermcp/protocolはBridge/Web library実装者向けvalidatorとdiscriminated message型を提供し、通常のapplication codeは@browsermcp/webだけをimportします。protocolはversion negotiationで発展するため、appはraw messageを送ったりWebSocketを標準MCPとして扱ったりしません。
bridge-configuration/network|network endpoint|既定MCP endpointはhttp://127.0.0.1:8789/mcp、browser endpointはws://127.0.0.1:8789/browserで、共通port 8789を使いhostは変更不能な127.0.0.1です。port変更はMCP clientとWeb appの双方へ反映し、LAN・external bindは非対応です。
bridge-configuration/https-site|HTTPS公開siteとlocal WSS|公開HTTPS pageは127.0.0.1をSANに含む証明書でBridgeを--tls-cert/--tls-key起動し、wss://127.0.0.1:8789/browserとhttps://127.0.0.1:8789/healthを使います。Webから申請してBridge管理画面でexact Originを承認し、CAだけをOS/browser storeで信頼します。Chromiumではcredential-free healthでLNAを先に許可し、HTTPSからwsへdowngradeしません。
bridge-configuration/limits|request上限|Bridgeのpayload、concurrency、deadline、idle session、ping間隔は有限です。operatorは環境に合わせて下げられますが、引上げはmemory・DoS riskを増やしTool schemaを上書きしません。timeoutはbrowserでのend-to-end実行を覆い、idle expiryとpingでorphan runtimeを除去します。
bridge-configuration/secrets-logs|承認とlog設定|pending Origin申請はboundedかつ短時間で失効し、固定browser secretを配布しません。legacy tokenだけを要求時に生成します。diagnostic保持はboundedで、credential field、Authorization、既知token pattern、URL credentialを保存前にredactし、result bodyをlogしません。
troubleshooting/diagnostic-order|診断順序|Bridge healthと正確なloopback endpointから始め、browserのexact Originとpaired Origin、認証・protocol negotiation、active session、登録capability名の順に確認します。routing成功後にだけbrowser handlerをdebugし、request IDでMCP・Bridge・site履歴を関連付け、log収集時にtokenを出しません。
troubleshooting/bridge-not-connected|Bridgeに接続できない|Bridgeが127.0.0.1:8789で動作することとsite panelの状態・最新safe errorを確認します。AUTH_REQUIREDは独立stateではなくerror codeです。MCP clientが接続済みでも機能がなければbrowser sessionまたは登録が失敗しているため、exact Originをpairして一度reconnectし、Bridge一覧を調べます。
troubleshooting/origin-error|Originが拒否された|location.originのscheme、host、portをBridge管理画面のpending申請と文字単位で比較します。localhostと127.0.0.1、変更されたVite portは別Originです。再申請してexact Originだけを承認し、'*'への拡張やvalidation無効化で回避しません。
troubleshooting/authentication-error|認証に失敗した|APPROVAL_REJECTEDでは利用者の拒否判断を確認し、APPROVAL_EXPIREDではtabを開いたまま再申請して期限内に判断します。legacy AUTH_INVALIDやSESSION_RESUME_REJECTEDでは新規承認または新しい互換tokenを使い、credentialをlogやissueへ貼りません。
troubleshooting/name-conflict|capability名の競合|conflict errorのapp、Origin、runtime、instance候補を確認します。標準MCP v0.1はinstance選択入力を公開しないため、古いduplicate tabをdisconnectまたはcloseして再試行します。Bridge順序や最新接続tabに依存せず、曖昧さを決定的に拒否します。
troubleshooting/version-mismatch|protocol versionの不一致|安全なdiagnosticでBridge、@browsermcp/web、advertised protocol versionを比較し、network調査前に同じcheckoutから全workspaceをbuildします。不一致を強制変換・無視せず、古いcomponentを互換releaseへ更新してfresh sessionで再接続します。
development/workspace|workspace構成|npm workspaceはprotocol型、公開Web library、共通Node.js Bridge、macOS lifecycle shell、Vite site、test、docsを分離します。Node.js 24以降、ESM、strict TypeScript、OS-neutral Bridge pathを維持し、platform APIで足りる場合はdependencyを増やしません。native app作業にはmacOS 14以降とXcodeも必要です。
development/site-architecture|site architecture|framework-free Vite UIは型付き英語Docsコーパスから表示とMCP応答を生成し、searchはDOMではなく構造化indexを使います。registration.tsがWeb libraryとの境界で、runtime utilityは上限付きIndexedDB/Workerを隔離します。i18nは英語正本へ翻訳overlayを適用し、locale変更でもhash route、controller、安定identifierを変えません。
development/github-pages-build|GitHub Pages subpath向けbuild|相対または明示Vite baseとhash routingでrepository pathへ配置できます。.github/workflows/pages.ymlはmainでnpm run checkを通し、Pagesのbase_pathで再buildしてsite/distだけをdeployします。公開HTTPS pageはlocal CA/WSS、credential-free health、LNA許可、pageからの申請、Bridge管理画面でのexact Origin承認を必要とします。同一OWNER.github.ioの全projectはOriginを共有します。
development/quality-gates|品質ゲート|repository rootでnpm run format:check、npm run typecheck、npm test、npm run buildを実行し、Docs MCPの10評価scenarioとsource/page/section traceabilityを確認します。自動化できないbrowser、native GUI、Linux、Windows、Intel Mac検証は前提、手順、期待結果、既知limitを記録します。
development/contributing|コントリビューション規約|app非依存の動作だけをprotocol/Bridgeへ追加し、業務logicはbrowser app、公開ergonomicsはWeb libraryへ置きます。公開動作と同時に構造化Docs・testを更新し、固定secret、personal path、生成credential、signing material、deploy outputをcommitしません。公開・署名・公証は対象外です。
roadmap/implemented|このrepositoryで実装済み|型付きprotocol、Web library、認証・namespace・lifecycleを持つcross-platform Bridge、macOS menu-bar app、framework-free Vite site、source-backed Docs Tool/Resource/Prompt、unit/integration testを実装しています。page/section単位のstatusもsearchとcapability queryから取得できます。
roadmap/verification-status|実環境での検証状況|GitHub Pages run 29643866925は全品質gateを通過し、https://masashi-desu.github.io/BrowserMCP/ をdeployしました。隔離したChromeでcontext限定LNA許可、loopback TLS Bridge、exact Origin承認、19/23/4登録、公式MCP SDKからのdocs_get_section呼び出しまで成功しています。loopback TLS errorはcontext内で無視したため、OSへの手動CA trust、対話的permission UI、Safari、Edge、Firefoxは未検証です。
roadmap/distribution|配布と対応platformの拡大|静的Docs siteはmainからGitHub Pagesへdeployします。npm、GitHub Releases、App Storeへの公開や署名・公証は行いません。BridgeはmacOS/Linux/Windowsを対象としますが検証済みはApple Silicon macOSだけで、installer、auto-update、bundled Node.js等は今後の作業です。
roadmap/security-hardening|今後のsecurity強化|初期実装はloopback bind、Origin-bound短時間pairing、runtime validation、上限、timeout、cancel、log redactionを強制します。独立security reviewとrelease用credential storageは未実施です。将来はBridgeへapp固有logicを入れず、capability単位consentやaudit exportを追加できます。
roadmap/known-constraints|既知の制約|検証済みhostはNode.js 24以降のApple Silicon macOSだけです。native appはmacOS 14以降専用・unsignedで外部Node.jsを要し、共通BridgeはOS serviceやcertificate trustを変更しません。handlerはbrowser security ruleとtab寿命に従い、duplicate tabは外部で解消します。cloud relayやremote browser transportはありません。`,
);

const zhCN = catalog(
  `introduction|介绍为何将浏览器作为BrowserMCP的MCP运行时。
architecture|介绍组件、信任边界和请求路由。
getting-started|从检出代码到调用第一个浏览器能力的最短路径。
installing-macos-bridge|直接运行跨平台Bridge，或由原生macOS应用管理它。
configuring-mcp-client|为所有已连接的浏览器应用注册一个Streamable HTTP端点。
creating-app|添加无框架依赖的Web库并声明浏览器能力。
tools|注册在浏览器中执行且由schema描述的操作。
resources|公开无需执行语义、可寻址的浏览器与文档内容。
prompts|发布可复用且由参数驱动的开发工作流。
results-errors|说明成功内容、执行失败、传输错误、超时与取消。
connection-lifecycle|说明配对、会话建立、能力同步、重连与清理。
bridge-protocol|Bridge与浏览器之间带类型和版本的内部协议。
security-model|说明信任边界、Origin绑定配对、限制、验证与秘密处理。
multiple-applications|说明身份、命名空间、标签页、冲突处理和确定性路由。
api-reference|Web应用使用的BrowserMCP公共API与类型。
bridge-configuration|说明loopback端点、Origin策略、限制、日志和运行默认值。
troubleshooting|按证据诊断连接、Origin、认证、版本和路由故障。
development|说明workspace结构、站点架构、质量门槛和贡献边界。
roadmap|列出已实现范围、计划工作与已知限制。`,
  `introduction/problem|BrowserMCP解决的问题|许多MCP集成会另建服务器，即使逻辑、数据和用户上下文已在Web应用中。BrowserMCP让执行留在浏览器，由通用本地Bridge向MCP客户端公开已连接应用的能力，而不把应用业务逻辑放进Bridge。
introduction/browser-runtime|浏览器就是MCP运行时|handler在已连接页面内运行，可使用JavaScript、Worker、WASM、IndexedDB、Canvas及Web API。Bridge只负责认证与路由，不把浏览器拥有的实现迁移到本地Bridge或原生应用进程。
introduction/one-client-entry|一个MCP客户端配置|MCP客户端只需通过Streamable HTTP连接http://127.0.0.1:8789/mcp，即可发现各应用的命名空间能力。loopback不是信任边界；新的浏览器连接必须由用户明确批准精确Origin。
architecture/components|核心组件与可选macOS外壳|MCP客户端使用标准MCP Streamable HTTP；跨平台Node.js Bridge把标准操作转换为独立的BrowserMCP Bridge Protocol；Web库再分派到声明式browser handler。protocol、web package和各应用各自拥有wire类型、连接状态以及业务能力，macOS应用只管理同一Bridge进程。
architecture/responsibility-boundaries|职责边界|Bridge负责loopback监听、MCP会话、认证、路由、限制、取消、超时与结果转换；浏览器应用负责能力声明、语义输入校验、页面上下文和执行；MCP客户端负责用户意图与审批。不得把应用特有的搜索、存储或工作流逻辑加入Bridge。
architecture/request-flow|请求流程|Bridge接收MCP请求，把命名空间能力解析到唯一runtime，创建Bridge Protocol request ID并转发invoke。Web库调用已注册handler并返回结果或结构化执行错误。timeout与cancel跨边界传播，runtime断开时其能力及无法完成的请求会被移除。
getting-started/prerequisites|前置条件|通用Bridge需要Node.js 24+、npm 11+、IPv4 loopback、当前浏览器及Streamable HTTP MCP客户端；公开HTTPS静态应用还需活动浏览器信任的IP有效本地证书。macOS应用需要macOS 14+与Xcode，目前只有Apple Silicon macOS经过实机验证。
getting-started/workspace-setup|安装并验证workspace|在repository root运行npm install，再用npm run typecheck、npm test、npm run format:check和npm run build验证全部workspace。Docs site可用npm run dev -w @browsermcp/site在loopback启动，不需要外部服务或部署。
getting-started/first-round-trip|完成第一次往返调用|从CLI或BrowserMCP.app启动Bridge，在site中申请连接，并在已认证的Bridge管理页面批准精确Origin和应用身份。MCP客户端配置http://127.0.0.1:8789/mcp，然后确认Tool列表及docs_search来源。
installing-macos-bridge/build|构建并运行跨平台Bridge|权威Bridge是/bridge中的Node.js 24本地进程；使用npm run build:bridge构建、npm run start:bridge启动。macOS、Linux和Windows使用相同CLI、配置、loopback端点、PEM TLS输入与protocol。它不会安装OS service或改变证书信任，目前只验证了Apple Silicon macOS。
installing-macos-bridge/start|构建并使用原生macOS应用|以CODE_SIGNING_ALLOWED=NO构建BrowserMCPApp scheme后，macOS 14+的菜单栏应用可启动、停止和重启同一Bridge进程，并管理Node/Bridge选择、endpoint、显式credential显示、待处理exact-Origin批准及Approve/Reject、legacy token兼容、计数、状态页、日志和错误。Node.js 24是外部runtime，秘密与进程状态只驻留内存。
installing-macos-bridge/pair-site|批准浏览器Origin|网页提出申请；在已认证的Bridge管理页面核对完全匹配的scheme、host、port和应用身份，再选择Approve或Reject。批准前没有session或注册，网页无需token输入。--pair-origin仅用于旧版兼容。
configuring-mcp-client/client-entry|添加通用Bridge|只创建一个名为browsermcp的MCP server entry，设置Streamable HTTP的http://127.0.0.1:8789/mcp及Bridge每次启动只显示一次的Authorization: Bearer MCP token。它与browser pairing和admin token不同，不要为每个Web应用建entry，也不要提交共享配置。
configuring-mcp-client/verify|验证初始化与发现|site配对后重新连接MCP session或刷新能力发现，确认每个runtime的命名空间Tool、Resource与Prompt出现。若Bridge有响应但site能力缺失，应先检查Bridge应用列表和site连接面板，再修改客户端配置。
configuring-mcp-client/client-trust|客户端审批|能力发现不会替代MCP客户端的审批策略。把browser提供的description和result视为来自paired Origin的数据，对有影响的Tool继续执行用户审批与输入大小策略。本站Tool只读或限定Origin，但其他site可在不同namespace公开其他行为。
creating-app/minimal-app|创建并连接应用|在bundler project安装@browsermcp/web，每个Web application runtime创建一个BrowserMCP实例，使用稳定app identity并用runtime identity区分标签页与重连。尽量在connect前注册Tool、Resource、Prompt；之后的注册变更也会同步到Bridge。
creating-app/static-hosting|使用静态托管|Web库不依赖UI框架，可由Vite等bundle或作为ESM导入，不需专用backend即可作为静态文件发布，包括GitHub Pages repository subpath。远程应用必须使用HTTPS；即使Bridge为wss也拒绝可被篡改的HTTP Origin，plain HTTP仅限localhost/127.0.0.1开发。
creating-app/registration-lifecycle|管理注册生命周期|注册method返回含id、ready和unregister()的RegistrationHandle。需要连接ack时等待ready，上下文失效时调用unregister()；disconnect会移除该runtime全部能力。local name保持稳定，由Bridge的app namespace避免不同应用互相覆盖。
tools/register-tool|注册Tool|app.tool声明在浏览器执行的操作。提供local name、description、封闭JSON Schema和异步handler，在handler中继续校验语义约束并返回标准MCP content item。description应说明副作用和browser状态，Bridge传输限制不能替代业务规则。
tools/tool-safety|设计安全Tool|为string、array、object设置实际的JSON Schema上限；长任务遵守AbortSignal；可能重试时优先幂等。不得公开pairing token、browser credential、cross-origin数据或任意script执行；browser API要求用户手势时用结构化error说明。
tools/site-tools|本站公开的Tool|site注册Docs搜索/获取/实现辅助/诊断、当前page、结构、navigation、runtime/status、限定Origin的IndexedDB storage及Web Worker文本分析Tool。刻意不允许MCP任意导航；storage键值和Worker输入有大小限制，且不执行任意代码。
resources/register-resource|注册Resource|app.resource注册由application URI标识的content，返回带准确MIME type的text或binary contents，不把Resource read用于状态修改。资源可以反映live page state，但调用方应把每次读取视为新snapshot。
resources/site-resources|文档Resource|browsermcp://docs/index、browsermcp://docs/page/{pageId}与browsermcp://docs/status提供page ID、path、description、status和section；browsermcp://site/current-page与browsermcp://site/status提供live route和连接snapshot。所有值都来自同一带类型的英文权威语料库。
resources/resource-errors|Resource错误|不存在的page或section不会返回空成功content，而是返回带相关建议的结构化not-found error。所属runtime断开后Bridge移除注册，旧读取以capability unavailable失败，不会错误路由到其他runtime。
prompts/register-prompt|注册Prompt|app.prompt注册name、description、argument声明和handler，并在browser内生成MCP prompt message。校验argument长度，把值作为数据而非可执行代码插值。Prompt引导agent使用相关Tool/Resource，但不会绕过权限。
prompts/site-prompts|本站公开的开发Prompt|browsermcp_get_started、browsermcp_implement、browsermcp_diagnose与browsermcp_review_boundaries支持环境化安装、功能实现、取证式诊断及职责边界审查。它们要求客户端使用结构化Docs Tool并引用page/section path，而不是依赖自由摘要。
prompts/prompt-safety|Prompt安全|argument始终是不可信输入，输出只提供建议。限制长度，保持用户文本与指令的区别，生成message中不得包含pairing token或秘密。Prompt不能授权副作用；Tool执行仍是独立MCP操作，受client策略与handler校验约束。
results-errors/success-results|成功结果|Tool handler返回含MCP content item的result object；人读输出使用简洁text，支持时以structuredContent提供机器数据。Resource与Prompt使用各自标准MCP result shape，Web库负责与Bridge request ID关联。
results-errors/errors|执行与protocol错误|预期handler失败应与invalid message及runtime不可用区分。除timeout/cancel外，异常会被规范为HANDLER_ERROR，仅含有界安全消息且不暴露stack。不合法envelope、版本不支持、认证失败、超限和未知request ID在handler dispatch前拒绝。
results-errors/timeout-cancel|超时与取消|Bridge deadline或MCP客户端cancel会传到browser，Web库abort handler的AbortSignal并忽略迟到结果。handler必须在fetch、Worker job和循环中观察signal；取消不能回滚已经完成的副作用。
connection-lifecycle/state-machine|连接状态机|connect打开WebSocket并协商version/features，然后进入awaiting-approval。Bridge管理员批准exact Origin后才建立session、发布capability，connected runtime才能接收invoke。
connection-lifecycle/reconnect|安全重连|可重试的断开使用有界backoff，仅在有效期内提交session proof。过期或拒绝的credential会被清除；需要新session时由用户再次申请批准。持久store必须保护credential和runtime identity。
connection-lifecycle/disconnect|断开与清理|显式disconnect会尽可能发送protocol message、关闭socket、abort待处理handler、清除session credential并更新state subscriber。Bridge原子移除该runtime的全部能力，而不影响其他tab和应用。
bridge-protocol/separation|与标准MCP分离|标准MCP在Bridge终止。内部wire protocol不隧道传输raw MCP，而以Bridge拥有的类型表示连接、认证、协商、注册、调用、结果、执行错误、取消、心跳与断开。这样MCP transport细节不会泄漏到Web app handler，Bridge也可跨应用复用。
bridge-protocol/envelope|envelope与标识符|每条message包含protocol version、message kind、session context和有界payload。handshake说明app/Origin/runtime/instance/version/features；request携带唯一request ID与capability引用；result/error只引用该ID一次。v1拒绝未知字段、未知kind、缺少必填项、重复终止响应与超大payload。
bridge-protocol/handshake|handshake与协商|browser公布version和capability，Bridge选择共同version。v1.1的approval无需credential并返回approval_required；只有exact Origin获得明确批准后才建session和注册。v1.0仅作为token/resume兼容路径。
bridge-protocol/validation|message验证|TypeScript类型只是编译期辅助，不是安全边界。两端在运行时验证不可信JSON，实施size/concurrency限制并检查状态顺序。日志只记录安全error code、kind与correlation ID，遮蔽已知credential和URL credential，且从不记录handler result body。
security-model/trust-boundaries|信任边界|MCP client、本地Bridge与browser Origin是三个主体。loopback阻止LAN暴露但不认证本地进程或任意网页；安全主体是exact Origin，app/runtime/instance只是自声明routing metadata。同一Origin代码拥有相同权限，MCP客户端审批和应用参数验证仍然必需。
security-model/pairing|Origin绑定批准|browser无需credential即可申请。Bridge在已认证管理页显示有时限的等待request和exact Origin，管理员Approve前不建session或注册；Reject或超时即关闭。OWNER.github.io的各项目共享一个Origin。
security-model/input-limits|限制与拒绝|Bridge和Web库对payload size、每runtime并发请求、deadline与cancel实施有限上限，应用再按能力加入更严格schema限制。未知kind、不兼容版本、未认证注册、未知能力、非法request ID及malformed JSON都应fail closed，不猜测兼容解释。
security-model/known-boundaries|已知安全边界|capability以页面Origin权限运行，可访问该Origin的browser storage，但BrowserMCP不会绕过same-origin policy、permission prompt、secure context或user gesture。paired Origin任意代码被攻破都会影响其能力；v0.1无单项撤销，需要断开/关闭标签页或重启Bridge撤销内存权限。
multiple-applications/identity|应用与runtime身份|应用为命名空间和路由自声明app ID、name、version、runtime ID、instance ID，WebSocket提供browser认证的exact Origin。显示名和routing tuple不是独立安全身份，resume token在配对后绑定Origin与tuple；互不信任的应用应使用不同Origin。
multiple-applications/namespacing|名称与冲突|Bridge可见名称含app namespace，不同应用可以注册同一local name。同一app/Origin的多个标签页提供同一能力时，Bridge报告ambiguous target并拒绝调用。v0.1无instance选择字段，应关闭重复provider后重试，禁止last-writer-wins。
multiple-applications/runtime-selection|runtime选择与移除|descriptor保留app、Origin、runtime、instance metadata，但标准MCP v0.1无法显式选择instance，因此只应保留一个provider。target断开时返回unavailable而不静默改路由，并只原子移除该runtime的能力与in-flight request。
api-reference/browsermcp|BrowserMCP class|new BrowserMCP创建disconnected应用；tool/resource/prompt添加声明式注册；connect启动协商与认证；disconnect停止；reconnect开始有界重试。UI可订阅state和diagnostic event，但公共app API与内部protocol刻意分离，不应依赖message内部。
api-reference/registration-types|Tool、Resource与Prompt定义|ToolDefinition含name、description、inputSchema、handler；ResourceDefinition含uri、name、可选description/mimeType、handler；PromptDefinition含name、description、argument metadata、handler。name/URI是稳定app-local identifier，重复注册会拒绝而非覆盖。
api-reference/connection-types|连接与诊断类型|BrowserMCPOptions提供bridgeUrl、identity、重连、超时、批准等待上限、session store及LNA准备；ConnectOptions提供批准申请策略、可选旧版token、AbortSignal和LNA准备。snapshot含awaiting-approval及非秘密申请信息；日志有界、克隆并遮蔽credential。
api-reference/protocol-types|protocol类型是内部API|@browsermcp/protocol向Bridge/Web库实现者提供validator和discriminated message类型，普通应用只需导入@browsermcp/web。protocol通过version negotiation演进，应用不应发送raw message或把WebSocket当作标准MCP。
bridge-configuration/network|网络端点|默认MCP endpoint为http://127.0.0.1:8789/mcp，browser endpoint为ws://127.0.0.1:8789/browser，共用port 8789且host固定为127.0.0.1。更改port时必须同时更新MCP client与Web app，禁止LAN和external bind。
bridge-configuration/https-site|HTTPS站点与本地WSS|公开HTTPS页面使用SAN含127.0.0.1的证书，以--tls-cert/--tls-key启动Bridge并连接wss://127.0.0.1:8789/browser。网页申请后在Bridge管理页面批准exact Origin，只信任本地CA；Chromium先通过无凭据health允许LNA。
bridge-configuration/limits|请求限制|Bridge的payload、concurrency、deadline、idle session与ping都有有限默认值。可按环境降低，但提高会增加内存及DoS风险且不会覆盖Tool schema。timeout覆盖browser端到端执行，idle expiry与ping清理孤立runtime。
bridge-configuration/secrets-logs|批准与日志配置|待处理Origin申请有数量和期限限制，不分发固定browser secret；只有旧版token按需生成。diagnostic保留有界，在存储前遮蔽credential字段、Authorization、已知token及URL credential，且不记录result body。
troubleshooting/diagnostic-order|诊断顺序|先检查Bridge health与精确loopback端点，再比较browser exact Origin与paired Origin，检查认证、protocol协商、active session和注册能力名。路由成功后再调试browser handler，以request ID关联MCP、Bridge、site历史，收集日志时不得暴露token。
troubleshooting/bridge-not-connected|Bridge未连接|确认Bridge在127.0.0.1:8789运行，并查看site面板状态与最新安全错误；AUTH_REQUIRED是错误码而非状态。若MCP client已连接但能力缺失，说明browser session或注册失败，应配对exact Origin、重连一次并检查Bridge列表。
troubleshooting/origin-error|Origin被拒绝|逐字符比较location.origin与Bridge管理页面中的待处理申请；localhost、127.0.0.1和不同Vite port都是不同Origin。重新申请并只批准exact Origin，绝不能用'*'或关闭验证绕过。
troubleshooting/authentication-error|认证失败|APPROVAL_REJECTED表示用户拒绝；APPROVAL_EXPIRED时保持标签页打开并重新申请。旧版AUTH_INVALID或SESSION_RESUME_REJECTED需要新的批准或兼容token；切勿把credential贴入日志或issue。
troubleshooting/name-conflict|能力名称冲突|检查conflict error中的app、Origin、runtime与instance候选。标准MCP v0.1无instance选择输入，应断开或关闭过期重复标签页后重试。不要依赖Bridge顺序或最新连接标签页，默认应确定性拒绝歧义。
troubleshooting/version-mismatch|protocol版本不匹配|在安全diagnostic中比较Bridge、@browsermcp/web及公布的protocol version，并先从同一checkout构建全部workspace。不要强制或忽略不匹配，应把较旧component升级到兼容release并以fresh session重连。
development/workspace|workspace布局|npm workspace分离protocol定义、公共Web库、通用Node.js Bridge、macOS lifecycle外壳、Vite site、test和docs。使用Node.js 24+，保持ESM、strict TypeScript与OS-neutral Bridge path，平台API足够时不增加依赖；native app还需macOS 14+和Xcode。
development/site-architecture|site架构|无框架Vite UI从带类型的英文Docs正本生成页面与MCP响应，search使用结构化index而非DOM。registration.ts是Web库集成边界，runtime utility隔离有限IndexedDB/Worker。i18n把翻译overlay应用到正本，切换locale不会改变hash route、controller或稳定identifier。
development/github-pages-build|为GitHub Pages子路径构建|.github/workflows/pages.yml在main运行npm run check，使用Pages的base_path重新构建并仅部署site/dist。公开HTTPS页面仍需本地CA/WSS、无凭据health、LNA许可、页面申请和Bridge管理页的exact Origin批准。同一OWNER.github.io的项目共享Origin。
development/quality-gates|质量门槛|在repository root运行npm run format:check、npm run typecheck、npm test与npm run build，并验证Docs MCP十个评估场景及source/page/section可追溯性。无法自动化的browser、native GUI、Linux、Windows、Intel Mac检查应记录前提、步骤、预期结果和限制。
development/contributing|贡献规则|只把应用无关行为加入protocol/Bridge；业务逻辑留在browser app，公共易用性留在Web库。公共行为变化时同步更新结构化Docs与test，禁止提交固定secret、个人路径、生成credential、签名材料或deploy输出。发布、签名与公证不在范围内。
roadmap/implemented|本repository已实现|已实现带类型protocol、Web库、含认证/namespace/lifecycle的跨平台Bridge、macOS菜单栏应用、无框架Vite site、source-backed Docs Tool/Resource/Prompt及unit/integration test。page/section级状态也可由search和capability query获取。
roadmap/verification-status|真实环境验证状态|GitHub Pages run 29643866925通过全部质量gate并部署了https://masashi-desu.github.io/BrowserMCP/。隔离Chrome中的context级LNA许可、loopback TLS Bridge、exact Origin批准、19/23/4注册以及官方MCP SDK调用docs_get_section均已成功。由于loopback TLS error只在context内忽略，OS手动CA trust、交互式permission UI、Safari、Edge和Firefox尚未验证。
roadmap/distribution|分发与更广平台支持|静态Docs site从main部署到GitHub Pages；npm、GitHub Releases和App Store发布以及签名、公证仍不在范围内。Bridge面向macOS/Linux/Windows但仅验证Apple Silicon macOS。
roadmap/security-hardening|未来安全强化|初始实现强制loopback bind、Origin绑定短效配对、runtime validation、限制、timeout、cancel与log redaction。独立安全审查和release credential storage尚未完成；未来可在不向Bridge加入应用业务逻辑的前提下增加按能力consent与audit export。
roadmap/known-constraints|已知限制|已验证host仅为Node.js 24+的Apple Silicon macOS。native app仅支持macOS 14+、未签名且依赖外部Node.js；通用Bridge不安装OS service或改变证书信任。handler受browser安全规则及标签页寿命约束，重复标签页须外部处理；未实现cloud relay或remote browser transport。`,
);

const es = catalog(
  `introduction|Por qué BrowserMCP usa el navegador como entorno de ejecución MCP.
architecture|Componentes, límites de confianza y enrutamiento de solicitudes.
getting-started|Ruta mínima desde el repositorio hasta la primera capacidad del navegador.
installing-macos-bridge|Ejecución del Bridge multiplataforma y supervisión opcional con la app de macOS.
configuring-mcp-client|Un único endpoint Streamable HTTP para todas las aplicaciones conectadas.
creating-app|Integración de la biblioteca web y declaración de capacidades del navegador.
tools|Operaciones ejecutables en el navegador descritas mediante schemas.
resources|Contenido direccionable del navegador y la documentación sin semántica de ejecución.
prompts|Flujos de desarrollo reutilizables controlados por argumentos.
results-errors|Resultados, fallos, errores de transporte, timeout y cancelación.
connection-lifecycle|Emparejamiento, sesión, sincronización, reconexión y cierre.
bridge-protocol|Protocolo interno tipado y versionado entre Bridge y navegador.
security-model|Límites de confianza, emparejamiento por Origin, límites y secretos.
multiple-applications|Identidad, namespaces, pestañas, conflictos y enrutamiento determinista.
api-reference|API y tipos públicos de BrowserMCP para aplicaciones web.
bridge-configuration|Endpoints loopback, política de Origin, límites y registros.
troubleshooting|Diagnóstico basado en evidencias de conexión, autenticación y routing.
development|Workspace, arquitectura del sitio, controles de calidad y contribución.
roadmap|Alcance implementado, trabajo previsto y restricciones conocidas.`,
  `introduction/problem|El problema que resuelve BrowserMCP|BrowserMCP evita duplicar la lógica web en servidores MCP separados: la ejecución permanece en el navegador y un Bridge genérico publica sus capacidades sin incorporar lógica de negocio.
introduction/browser-runtime|El navegador es el runtime MCP|Los handlers se ejecutan junto a JavaScript, Workers, WASM, IndexedDB, Canvas y Web APIs; el Bridge solo autentica y enruta.
introduction/one-client-entry|Una entrada de cliente MCP|El cliente configura una vez http://127.0.0.1:8789/mcp y descubre aplicaciones con namespace. Loopback no es una frontera de confianza; cada conexión nueva requiere aprobación explícita de su Origin exacto.
architecture/components|Componentes principales y shell opcional de macOS|El cliente usa MCP estándar, el Bridge Node.js lo convierte al BrowserMCP Bridge Protocol y la biblioteca web invoca handlers declarativos; la app de macOS solo supervisa el mismo proceso.
architecture/responsibility-boundaries|Límites de responsabilidad|El Bridge posee sesiones, autenticación, routing, límites, timeout y conversión; la app posee declaraciones, validación semántica y ejecución; el cliente posee intención y aprobación.
architecture/request-flow|Flujo de solicitudes|El Bridge resuelve una capacidad a un runtime, crea un request ID y reenvía invoke; resultados, errores, timeout, cancelación y desconexión se propagan de forma correlacionada.
getting-started/prerequisites|Requisitos previos|Se requieren Node.js 24+, npm 11+, loopback IPv4, navegador actual y cliente Streamable HTTP; HTTPS público necesita certificado local confiable y la app nativa requiere macOS 14+ y Xcode.
getting-started/workspace-setup|Instalar y validar el workspace|Ejecute npm install y después typecheck, test, format:check y build desde la raíz; el sitio se inicia en loopback sin servicio externo.
getting-started/first-round-trip|Completar la primera llamada|Inicie el Bridge, solicite acceso desde el sitio y apruebe el Origin exacto y la identidad de la aplicación en la administración autenticada. Configure el endpoint MCP para listar Tools y ejecutar docs_search.
installing-macos-bridge/build|Construir y ejecutar el Bridge multiplataforma|El Bridge autorizado vive en /bridge y usa el mismo CLI, configuración, endpoints y PEM en macOS, Linux y Windows; no instala servicios ni modifica la confianza del sistema.
installing-macos-bridge/start|Construir y usar la app nativa de macOS|La app de barra de menús sin firma gestiona el mismo Bridge, Node externo, endpoints, credenciales explícitas, solicitudes pendientes de aprobación del Origin con Approve/Reject, compatibilidad legacy de token, estado y logs; los secretos permanecen en memoria.
installing-macos-bridge/pair-site|Aprobar un Origin del navegador|Solicite acceso desde la página, verifique scheme, host, port e identidad en la administración del Bridge y elija Approve o Reject. Antes de aprobar no hay sesión ni registros; --pair-origin queda como compatibilidad heredada.
configuring-mcp-client/client-entry|Añadir el Bridge común|Cree una sola entrada browsermcp con Streamable HTTP, la URL loopback y el MCP bearer de cada arranque; no confunda este secreto con pairing o admin.
configuring-mcp-client/verify|Verificar inicialización y descubrimiento|Tras emparejar el sitio, actualice la sesión y confirme Tools, Resources y Prompts con namespace; si faltan, revise primero las listas del Bridge y el panel del sitio.
configuring-mcp-client/client-trust|Aprobación del cliente|El descubrimiento no sustituye la aprobación: trate descriptions y resultados como datos del Origin emparejado y mantenga políticas de usuario y tamaño.
creating-app/minimal-app|Crear y conectar una app|Instale @browsermcp/web, cree una instancia con identidad estable, registre capacidades antes de connect y sincronice los cambios posteriores con el Bridge.
creating-app/static-hosting|Usar hosting estático|La biblioteca funciona con ESM y bundlers sin backend específico; los Origins remotos deben usar HTTPS y HTTP plano queda limitado a localhost.
creating-app/registration-lifecycle|Gestionar registros|Conserve RegistrationHandle, espere ready cuando importe el ack y llame unregister al perder validez; disconnect elimina todas las capacidades del runtime.
tools/register-tool|Registrar un Tool|app.tool combina nombre local, description, JSON Schema cerrado y handler asíncrono; valide reglas semánticas y declare efectos secundarios.
tools/tool-safety|Diseñar Tools seguros|Limite inputs, respete AbortSignal, prefiera idempotencia y no exponga tokens, credenciales, datos cross-origin ni evaluación arbitraria.
tools/site-tools|Tools publicados por este sitio|El sitio publica Docs, contexto, runtime, storage IndexedDB por Origin y análisis Worker con límites; no permite navegación ni código arbitrarios.
resources/register-resource|Registrar un Resource|app.resource asocia una URI estable a una lectura async con MIME correcto; cada lectura de estado vivo es un snapshot nuevo y no debe cambiar estado.
resources/site-resources|Resources de documentación|Las URI browsermcp://docs y browsermcp://site exponen corpus, páginas, estados y snapshots desde el mismo corpus inglés tipado.
resources/resource-errors|Errores de Resource|Los elementos ausentes devuelven not-found estructurado; al desconectar el runtime, las lecturas fallan como capability unavailable sin reenrutarse.
prompts/register-prompt|Registrar un Prompt|app.prompt valida argumentos y produce mensajes MCP tratando valores como datos; orienta hacia Tools y Resources sin omitir permisos.
prompts/site-prompts|Prompts de desarrollo del sitio|Los prompts guían instalación, implementación, diagnóstico y revisión de límites usando Docs estructurados y citas page/section.
prompts/prompt-safety|Seguridad de Prompt|Los argumentos siguen sin ser fiables, la salida es orientativa y nunca autoriza efectos ni incluye pairing tokens o secretos.
results-errors/success-results|Resultados correctos|Los Tools devuelven content y, cuando procede, structuredContent; Resources y Prompts conservan sus shapes MCP y el request ID correlaciona la respuesta.
results-errors/errors|Errores de ejecución y protocolo|Las excepciones se normalizan a HANDLER_ERROR seguro sin stack; envelopes, versiones, autenticación, tamaño e IDs inválidos se rechazan antes del handler.
results-errors/timeout-cancel|Timeout y cancelación|El deadline o cancel del cliente aborta el AbortSignal del handler e ignora resultados tardíos; no puede revertir un efecto ya completado.
connection-lifecycle/state-machine|Máquina de estados de conexión|connect abre WebSocket, negocia version/features y entra en awaiting-approval. Solo después de que el administrador apruebe el Origin exacto se crea la session, se publican capabilities y el runtime connected recibe invoke.
connection-lifecycle/reconnect|Reconectar con seguridad|Una pérdida recuperable usa backoff limitado y presenta session proof solo mientras sea válido. Una credential vencida o rechazada se elimina; si hace falta una session nueva, la persona vuelve a solicitar aprobación. Un store persistente protege credential e identidad.
connection-lifecycle/disconnect|Desconectar y limpiar|disconnect cierra socket, aborta trabajo, borra credenciales de sesión y elimina atómicamente solo las capacidades de ese runtime.
bridge-protocol/separation|Separación del MCP estándar|MCP termina en el Bridge; el protocolo interno modela conexión, registro, invoke, resultados, errores, cancelación y heartbeat sin transportar mensajes MCP crudos.
bridge-protocol/envelope|Envelope e identificadores|Cada mensaje tiene versión, kind, contexto y payload limitado; IDs correlacionan una sola respuesta terminal y v1 rechaza campos, kinds o tamaños desconocidos.
bridge-protocol/handshake|Handshake y negociación|Las partes acuerdan version y features. En v1.1, approval no lleva credential y recibe approval_required; session y registro solo existen tras aprobar explícitamente el Origin exacto. v1.0 queda como compatibilidad token/resume.
bridge-protocol/validation|Validación de mensajes|Ambos extremos validan JSON en runtime, límites y orden de estado; los logs omiten cuerpos y redactan credenciales conocidas.
security-model/trust-boundaries|Límites de confianza|Cliente, Bridge y Origin son principals separados; loopback no autentica páginas y los identificadores declarados son metadata de routing, no identidades de seguridad.
security-model/pairing|Aprobación vinculada al Origin|El browser solicita sin credential. Bridge muestra una request breve y el Origin exacto en la administración autenticada; no crea session ni registros hasta Approve, y Reject o expiry cierran la espera. Los proyectos OWNER.github.io comparten Origin.
security-model/input-limits|Límites y rechazo|Tamaño, concurrencia, tiempo y shapes son finitos; mensajes desconocidos, no autenticados o mal formados fallan de forma cerrada.
security-model/known-boundaries|Límites de seguridad conocidos|Una capacidad posee privilegios de su Origin pero no evita same-origin, permisos, contexto seguro ni gesto; v0.1 revoca al desconectar o reiniciar.
multiple-applications/identity|Identidad de aplicación y runtime|Origin es el principal observado; app, runtime e instance son metadata declarada y apps no confiables deben separarse por Origin.
multiple-applications/namespacing|Nombres y colisiones|El namespace permite nombres locales iguales entre apps; proveedores duplicados de app/Origin producen ambigüedad y nunca last-writer-wins.
multiple-applications/runtime-selection|Selección y eliminación de runtime|v0.1 no selecciona instance: debe quedar un proveedor; la desconexión elimina solo ese runtime sin reenrutamiento silencioso.
api-reference/browsermcp|Clase BrowserMCP|La clase posee registros, estado, requests, logs y limpieza; use APIs públicas y eventos, no detalles del protocolo interno.
api-reference/registration-types|Definiciones de Tool, Resource y Prompt|Las definiciones tipadas unen metadata, schemas y handlers async; nombres y URI son identificadores estables y duplicados se rechazan.
api-reference/connection-types|Tipos de conexión y diagnóstico|Options controla URL, identidad, reconexión, tiempos, espera de aprobación, store y LNA. ConnectOptions controla la solicitud y un token heredado opcional; snapshot expone awaiting-approval y datos no secretos de la solicitud.
api-reference/protocol-types|Los tipos de protocolo son internos|@browsermcp/protocol sirve a implementadores; las apps usan @browsermcp/web y no envían mensajes crudos.
bridge-configuration/network|Endpoints de red|MCP y browser comparten 127.0.0.1:8789; el host no es configurable y cualquier cambio de port debe reflejarse en cliente y página.
bridge-configuration/https-site|Sitio HTTPS y WSS local|Use certificado SAN para 127.0.0.1 y wss/https; solicite acceso y apruebe el Origin exacto en el Bridge. Confíe solo en la CA local y ejecute health sin credenciales para LNA; nunca rebaje HTTPS a ws.
bridge-configuration/limits|Límites de solicitudes|Payload, concurrencia, deadline, idle y ping son finitos; elevarlos aumenta riesgo y no reemplaza schemas por Tool.
bridge-configuration/secrets-logs|Aprobación y logs|Las solicitudes pendientes son limitadas y caducan; solo los tokens heredados se generan bajo demanda. Los logs limitados redactan campos conocidos, Authorization y credenciales URL y no almacenan resultados.
troubleshooting/diagnostic-order|Orden de diagnóstico|Compruebe health, endpoints, Origin, autenticación, negociación, sesión, registros y routing antes del handler; correlacione por request ID sin exponer tokens.
troubleshooting/bridge-not-connected|Bridge no conectado|Diferencie listener ausente, página sin pairing, sesión vencida y registro fallido mediante estado y error seguro; AUTH_REQUIRED es un código.
troubleshooting/origin-error|Origin rechazado|Compare scheme, host y port con la solicitud pendiente del Bridge, vuelva a solicitar y apruebe solo el Origin exacto; no use '*' ni desactive la validación.
troubleshooting/authentication-error|Autenticación fallida|APPROVAL_REJECTED refleja un rechazo; ante APPROVAL_EXPIRED mantenga la pestaña abierta y repita. AUTH_INVALID heredado o SESSION_RESUME_REJECTED requiere nueva aprobación o token compatible; no registre credenciales.
troubleshooting/name-conflict|Conflicto de nombre|Revise candidatos y cierre pestañas duplicadas; v0.1 no selecciona instance y rechaza la ambigüedad.
troubleshooting/version-mismatch|Versión de protocolo incompatible|Compare versiones, reconstruya desde el mismo checkout y actualice el componente antiguo; no fuerce la compatibilidad.
development/workspace|Estructura del workspace|Protocol, web, Bridge, shell macOS, site, tests y docs permanecen separados con Node 24+, ESM, TypeScript estricto y rutas neutrales.
development/site-architecture|Arquitectura del sitio|La UI usa un corpus inglés tipado para render y MCP, índice estructurado y un adapter; i18n superpone traducción sin cambiar IDs, rutas ni controller.
development/github-pages-build|Build para subpath de GitHub Pages|.github/workflows/pages.yml ejecuta npm run check en main, recompila con base_path de Pages y despliega solo site/dist. El sitio HTTPS aún requiere CA/WSS local, health sin credenciales, permiso LNA y aprobación del Origin exacto en Bridge.
development/quality-gates|Controles de calidad|Format, typecheck, unit, integration y build son obligatorios; las verificaciones manuales deben registrar entorno, pasos, resultado esperado y límites.
development/contributing|Reglas de contribución|Mantenga lógica genérica en protocol/Bridge y lógica de app en el navegador; actualice Docs/tests y no publique secretos ni artefactos de despliegue.
roadmap/implemented|Implementado en este repositorio|Existen protocol tipado, Web library, Bridge portable, app macOS, sitio Vite, Docs MCP y tests con status por sección.
roadmap/verification-status|Estado de verificación real|GitHub Pages run 29643866925 superó todas las quality gates y desplegó https://masashi-desu.github.io/BrowserMCP/. En un Chrome aislado funcionaron el permiso LNA limitado al context, el loopback TLS Bridge, la aprobación del exact Origin, el registro 19/23/4 y la llamada docs_get_section desde el MCP SDK oficial. Como el context ignoró los loopback TLS error, aún no se verificaron el CA trust manual del OS, la permission UI interactiva, Safari, Edge ni Firefox.
roadmap/distribution|Distribución y otras plataformas|El sitio Docs se despliega a GitHub Pages desde main; npm, Releases, App Store, firma y notarización quedan fuera. Otras plataformas requieren validación futura.
roadmap/security-hardening|Endurecimiento futuro|Ya se aplican loopback, pairing, validación, límites y redacción; faltan revisión externa, almacenamiento de release y consent/audit más detallados.
roadmap/known-constraints|Restricciones conocidas|Solo Apple Silicon macOS está verificado; la app nativa requiere Node externo y las capacidades siguen las reglas del navegador, sin relay cloud ni browser remoto.`,
);

const hi = catalog(
  `introduction|BrowserMCP ब्राउज़र को MCP रनटाइम क्यों बनाता है।
architecture|घटक, भरोसे की सीमाएँ और अनुरोध routing।
getting-started|checkout से पहली browser capability तक का सबसे छोटा मार्ग।
installing-macos-bridge|cross-platform Bridge चलाना और वैकल्पिक macOS app से प्रबंधन।
configuring-mcp-client|सभी जुड़े browser apps के लिए एक Streamable HTTP endpoint।
creating-app|Web library जोड़ना और browser capabilities घोषित करना।
tools|schema से वर्णित, browser में चलने वाले operations।
resources|execution के बिना addressable browser और documentation content।
prompts|arguments से संचालित दोबारा उपयोग योग्य development workflows।
results-errors|सफलता, execution failure, transport error, timeout और cancellation।
connection-lifecycle|pairing, session, capability sync, reconnect और cleanup।
bridge-protocol|Bridge और browser के बीच typed, versioned internal protocol।
security-model|trust boundaries, Origin-bound pairing, limits और secrets।
multiple-applications|identity, namespaces, tabs, conflicts और deterministic routing।
api-reference|Web apps के लिए BrowserMCP public APIs और types।
bridge-configuration|loopback endpoints, Origin policy, limits और logs।
troubleshooting|connection, auth, version और routing की evidence-first जाँच।
development|workspace, site architecture, quality gates और contribution boundaries।
roadmap|implemented scope, planned work और known constraints।`,
  `introduction/problem|BrowserMCP किस समस्या को हल करता है|Web app में logic और data पहले से होने पर अलग MCP server उसे दोहराता है। BrowserMCP execution को browser में रखकर generic local Bridge से capabilities प्रकाशित करता है।
introduction/browser-runtime|ब्राउज़र ही MCP runtime है|Handlers JavaScript, Workers, WASM, IndexedDB, Canvas और Web APIs के साथ page में चलते हैं; Bridge केवल authentication और routing करता है।
introduction/one-client-entry|एक MCP client entry|Client केवल http://127.0.0.1:8789/mcp configure करता है। Loopback trust boundary नहीं है; हर नई browser connection के exact Origin को explicit operator approval चाहिए।
architecture/components|मुख्य घटक और वैकल्पिक macOS shell|Client standard MCP बोलता है, Node.js Bridge उसे अलग Bridge Protocol में बदलता है और Web library declarative handlers चलाती है; macOS app उसी process की supervisor है।
architecture/responsibility-boundaries|जिम्मेदारी की सीमाएँ|Bridge sessions, auth, routing, limits और result conversion का मालिक है; app declarations, semantic validation और execution का; client intent और approval का।
architecture/request-flow|अनुरोध प्रवाह|Bridge capability को एक runtime से resolve कर request ID के साथ invoke भेजता है; result, error, timeout, cancel और disconnect correlated रहते हैं।
getting-started/prerequisites|पूर्वापेक्षाएँ|Node.js 24+, npm 11+, IPv4 loopback, current browser और Streamable HTTP client चाहिए; public HTTPS को trusted local certificate और native app को macOS 14+ व Xcode चाहिए।
getting-started/workspace-setup|workspace install और validate करें|Root पर npm install के बाद typecheck, test, format:check और build चलाएँ; site loopback पर बिना external service के चलता है।
getting-started/first-round-trip|पहला round trip पूरा करें|Bridge शुरू करें, site से access request भेजें और authenticated Bridge management में exact Origin तथा app identity approve करें। MCP endpoint पर Tools व docs_search जाँचें।
installing-macos-bridge/build|cross-platform Bridge build और run करें|Authoritative /bridge process macOS, Linux और Windows पर समान CLI, config, endpoint और PEM inputs उपयोग करता है; OS service या trust नहीं बदलता।
installing-macos-bridge/start|native macOS app build और उपयोग करें|Unsigned menu-bar app उसी Bridge को start/stop/restart करती है और external Node, endpoints, explicit credentials, लंबित exact-Origin approval के Approve/Reject, legacy token compatibility, status और logs संभालती है; secrets memory में रहते हैं।
installing-macos-bridge/pair-site|browser Origin approve करें|Page से request भेजें, Bridge management में exact scheme, host, port और app identity जाँचें, फिर Approve या Reject चुनें। Approval से पहले session या registration नहीं होता; --pair-origin legacy compatibility है।
configuring-mcp-client/client-entry|common Bridge जोड़ें|एक browsermcp entry में Streamable HTTP loopback URL और हर startup का MCP bearer रखें; pairing और admin tokens अलग हैं।
configuring-mcp-client/verify|initialization और discovery जाँचें|Pairing के बाद session refresh कर namespaced Tools, Resources और Prompts देखें; missing होने पर Bridge list और site panel पहले जाँचें।
configuring-mcp-client/client-trust|client-side approval|Discovery approval policy को नहीं बदलती; paired Origin के descriptions/results को untrusted data मानकर user approval और input limits बनाए रखें।
creating-app/minimal-app|app बनाएँ और connect करें|@browsermcp/web install कर stable identity वाली instance बनाएँ, connect से पहले capabilities register करें और बाद के बदलाव Bridge से sync करें।
creating-app/static-hosting|static hosting उपयोग करें|Library ESM और bundlers के साथ app-specific backend के बिना चलती है; remote Origins के लिए HTTPS अनिवार्य और plain HTTP केवल localhost है।
creating-app/registration-lifecycle|registrations manage करें|RegistrationHandle रखें, जरूरत पर ready await करें, context खत्म होने पर unregister करें; disconnect runtime की सभी capabilities हटाता है।
tools/register-tool|Tool register करें|app.tool में local name, description, closed JSON Schema और async handler दें; semantic rules validate करें और side effects लिखें।
tools/tool-safety|सुरक्षित Tools design करें|Inputs limit करें, AbortSignal मानें, idempotency चुनें और tokens, credentials, cross-origin data या arbitrary script न खोलें।
tools/site-tools|इस site के Tools|Site Docs, context, runtime, Origin-scoped IndexedDB और bounded Worker analysis देता है; arbitrary navigation या code execution नहीं।
resources/register-resource|Resource register करें|Stable URI को accurate MIME वाले async read से map करें; live state की हर read नया snapshot है और state नहीं बदलती।
resources/site-resources|documentation Resources|browsermcp://docs और browsermcp://site URIs canonical typed English corpus से pages, status और live snapshots देती हैं।
resources/resource-errors|Resource errors|Missing data structured not-found देता है; runtime disconnect पर stale reads unavailable होते हैं, दूसरे runtime पर route नहीं होते।
prompts/register-prompt|Prompt register करें|app.prompt arguments validate कर browser में MCP messages बनाता है; values data हैं और permissions bypass नहीं होतीं।
prompts/site-prompts|site के development Prompts|Prompts setup, implementation, diagnosis और boundary review को structured Docs तथा page/section citations से guide करते हैं।
prompts/prompt-safety|Prompt safety|Arguments untrusted और output advisory है; secrets शामिल न करें और side effects के लिए अलग Tool approval रखें।
results-errors/success-results|सफल परिणाम|Tools MCP content और optional structuredContent लौटाते हैं; Resources/Prompts standard shapes रखते हैं और request ID correlation देता है।
results-errors/errors|execution और protocol errors|Exceptions safe HANDLER_ERROR बनते हैं, stack नहीं निकलता; invalid envelope, version, auth, size और ID handler से पहले reject होते हैं।
results-errors/timeout-cancel|timeout और cancellation|Deadline या client cancel handler AbortSignal को abort करता और late result छोड़ता है; completed side effect rollback नहीं होता।
connection-lifecycle/state-machine|connection state machine|connect WebSocket खोलता, version/features negotiate करता और awaiting-approval में जाता है। Bridge admin के exact Origin approve करने के बाद ही session और capabilities बनते हैं, और connected runtime invoke लेता है।
connection-lifecycle/reconnect|सुरक्षित reconnect|Retryable loss bounded backoff उपयोग करता और session proof केवल valid रहने तक भेजता है। expired या rejected credential हटता है; नई session के लिए user फिर approval request करता है। persistent store credential और identity को सुरक्षित रखता है।
connection-lifecycle/disconnect|disconnect और cleanup|disconnect socket, pending work और session credentials साफ कर केवल उस runtime की capabilities atomically हटाता है।
bridge-protocol/separation|standard MCP से अलग|MCP Bridge पर खत्म होता है; internal protocol raw MCP tunnel किए बिना connect, register, invoke, result, cancel और heartbeat model करता है।
bridge-protocol/envelope|envelope और identifiers|हर message में version, kind, context और bounded payload है; request ID एक terminal response से जुड़ता और v1 unknown fields/kinds reject करता है।
bridge-protocol/handshake|handshake और negotiation|Common version और features तय होते हैं। v1.1 approval credential के बिना approval_required पाता है; exact Origin के explicit approval के बाद ही session/registration बनते हैं। v1.0 token/resume compatibility है।
bridge-protocol/validation|message validation|दोनों endpoints runtime JSON, size, concurrency और state order validate करते हैं; logs credential redact करते और result bodies नहीं रखते।
security-model/trust-boundaries|trust boundaries|MCP client, local Bridge और browser Origin अलग principals हैं; loopback page authenticate नहीं करता और declared IDs केवल routing metadata हैं।
security-model/pairing|Origin-bound approval|browser credential के बिना request करता है। Bridge authenticated admin page में short-lived request और exact Origin दिखाता है; Approve से पहले session/registration नहीं बनते, Reject या expiry पर wait बंद होता है।
security-model/input-limits|limits और rejection|Payload, concurrency, time और shapes bounded हैं; unknown, unauthenticated या malformed messages fail closed होते हैं।
security-model/known-boundaries|ज्ञात security boundaries|Capability अपने Origin privileges में चलती है और browser policies bypass नहीं करती; v0.1 में disconnect या restart से authority revoke होती है।
multiple-applications/identity|application और runtime identity|Observed Origin principal है; app/runtime/instance self-declared routing metadata हैं और mutually untrusted apps को अलग Origins चाहिए।
multiple-applications/namespacing|names और collisions|App namespace समान local names को अलग करता है; duplicate providers ambiguity बनाते हैं और last-writer-wins निषिद्ध है।
multiple-applications/runtime-selection|runtime selection और removal|v0.1 instance select नहीं करता; एक provider रखें और disconnect पर केवल उसी runtime को बिना silent reroute हटाएँ।
api-reference/browsermcp|BrowserMCP class|Class registrations, state, requests, logs और cleanup own करती है; public APIs/events उपयोग करें, internal message details नहीं।
api-reference/registration-types|Tool, Resource और Prompt definitions|Typed definitions metadata, schemas और async handlers जोड़ती हैं; stable names/URIs के duplicate registrations reject होते हैं।
api-reference/connection-types|connection और diagnostics types|Options URL, identity, reconnect, timeout, approval wait, store और LNA देते हैं। ConnectOptions request policy और optional legacy token देता है; snapshot awaiting-approval और non-secret request data दिखाता है।
api-reference/protocol-types|protocol types internal हैं|@browsermcp/protocol implementers के लिए है; normal apps @browsermcp/web उपयोग कर raw messages नहीं भेजते।
bridge-configuration/network|network endpoints|MCP और browser 127.0.0.1:8789 साझा करते हैं; host fixed है और port change client तथा page दोनों में होना चाहिए।
bridge-configuration/https-site|HTTPS site और local WSS|127.0.0.1 SAN certificate और wss/https उपयोग करें; request भेजकर Bridge में exact Origin approve करें। केवल local CA trust करें, credential-free health से LNA लें और HTTPS को ws पर downgrade न करें।
bridge-configuration/limits|request limits|Payload, concurrency, deadline, idle और ping finite हैं; limits बढ़ाना risk बढ़ाता और Tool schema replace नहीं करता।
bridge-configuration/secrets-logs|approval और logs|Pending Origin requests bounded और expiring हैं; केवल legacy tokens on demand बनते हैं। Bounded logs known credential fields, Authorization और URL secrets redact करते हैं और result body नहीं रखते।
troubleshooting/diagnostic-order|diagnostic order|Health, endpoints, Origin, auth, negotiation, session, registration और routing के बाद handler जाँचें; request ID से correlate करें, token न दिखाएँ।
troubleshooting/bridge-not-connected|Bridge connected नहीं|Listener, unpaired page, expired session और failed registration को state व safe error से अलग करें; AUTH_REQUIRED error code है।
troubleshooting/origin-error|Origin rejected|Scheme, host और port को Bridge की pending request से exact compare करें, दोबारा request भेजकर केवल exact Origin approve करें; '*' या validation disable न करें।
troubleshooting/authentication-error|authentication failed|APPROVAL_REJECTED में operator decision जाँचें; APPROVAL_EXPIRED पर tab खुला रखकर फिर request करें। Legacy AUTH_INVALID या SESSION_RESUME_REJECTED में नया approval या compatibility token लें; credential log न करें।
troubleshooting/name-conflict|capability name conflict|Candidates देखें और duplicate tabs बंद करें; v0.1 instance selection नहीं देता और ambiguity reject करता है।
troubleshooting/version-mismatch|protocol version mismatch|Versions compare कर same checkout build करें और older component update करें; mismatch force न करें।
development/workspace|workspace layout|Protocol, web, Bridge, macOS shell, site, tests और docs Node 24+, ESM, strict TypeScript और OS-neutral paths के साथ अलग रहें।
development/site-architecture|site architecture|Framework-free UI और MCP canonical typed English corpus व structured index उपयोग करते हैं; i18n translation overlay stable IDs/routes को नहीं बदलता।
development/github-pages-build|GitHub Pages subpath build|.github/workflows/pages.yml main पर npm run check चलाता है, Pages base_path से rebuild करता है और केवल site/dist deploy करता है। HTTPS site को local CA/WSS, credential-free health, LNA और Bridge में exact Origin approval अब भी चाहिए।
development/quality-gates|quality gates|Format, typecheck, unit, integration और production build आवश्यक हैं; manual checks environment, steps, expected result और limits लिखें।
development/contributing|contribution rules|Generic logic protocol/Bridge और app logic browser में रखें; Docs/tests sync करें और secrets या deploy output publish न करें।
roadmap/implemented|इस repository में implemented|Typed protocol, Web library, portable Bridge, macOS app, Vite site, Docs MCP और section status सहित tests उपलब्ध हैं।
roadmap/verification-status|वास्तविक environment verification|GitHub Pages run 29643866925 ने सभी quality gate पास करके https://masashi-desu.github.io/BrowserMCP/ deploy किया। अलग Chrome context में LNA permission, loopback TLS Bridge, exact Origin approval, 19/23/4 registration और official MCP SDK से docs_get_section call सफल रहे। Context ने loopback TLS error को अनदेखा किया था, इसलिए OS में manual CA trust, interactive permission UI, Safari, Edge और Firefox अभी verify नहीं हुए हैं।
roadmap/distribution|distribution और broader platforms|Docs site main से GitHub Pages पर deploy होता है; npm, Releases, App Store, signing और notarization scope से बाहर हैं। अन्य platforms को future validation चाहिए।
roadmap/security-hardening|future security hardening|Loopback, pairing, validation, limits और redaction लागू हैं; external review, release storage और finer consent/audit future work है।
roadmap/known-constraints|known constraints|केवल Apple Silicon macOS verified है; native app external Node चाहता है और browser rules लागू रहते हैं, cloud relay या remote browser transport नहीं।`,
);

const ar = catalog(
  `introduction|لماذا يستخدم BrowserMCP المتصفح كبيئة تشغيل MCP.
architecture|المكوّنات وحدود الثقة وتوجيه الطلبات.
getting-started|أقصر مسار من المستودع إلى أول قدرة في المتصفح.
installing-macos-bridge|تشغيل Bridge متعدد المنصات وإدارته اختياريًا بتطبيق macOS.
configuring-mcp-client|نقطة Streamable HTTP واحدة لكل تطبيقات المتصفح المتصلة.
creating-app|إضافة مكتبة Web والتصريح بقدرات المتصفح.
tools|عمليات موصوفة بمخطط وتُنفّذ في المتصفح.
resources|محتوى متصفح وتوثيق قابل للعنونة من دون دلالة تنفيذ.
prompts|مسارات تطوير قابلة لإعادة الاستخدام تقودها الوسائط.
results-errors|النتائج وإخفاق التنفيذ وأخطاء النقل والمهلة والإلغاء.
connection-lifecycle|الاقتران والجلسة ومزامنة القدرات وإعادة الاتصال والتنظيف.
bridge-protocol|بروتوكول داخلي منمط وذي إصدارات بين Bridge والمتصفح.
security-model|حدود الثقة والاقتران المرتبط بـ Origin والقيود والأسرار.
multiple-applications|الهوية ومساحات الأسماء وعلامات التبويب والتعارض والتوجيه الحتمي.
api-reference|واجهات BrowserMCP العامة وأنواعها لتطبيقات Web.
bridge-configuration|نقاط loopback وسياسة Origin والقيود والسجلات.
troubleshooting|تشخيص قائم على الأدلة للاتصال والمصادقة والإصدار والتوجيه.
development|بنية workspace ومعمارية الموقع وبوابات الجودة وحدود المساهمة.
roadmap|النطاق المنفذ والعمل المخطط والقيود المعروفة.`,
  `introduction/problem|المشكلة التي يحلها BrowserMCP|بدل تكرار منطق تطبيق Web في خادم MCP منفصل، يبقي BrowserMCP التنفيذ في المتصفح وينشر القدرات عبر Bridge محلي عام بلا منطق أعمال خاص بالتطبيق.
introduction/browser-runtime|المتصفح هو بيئة MCP|تعمل handlers مع JavaScript وWorkers وWASM وIndexedDB وCanvas وWeb APIs داخل الصفحة، بينما يقتصر Bridge على المصادقة والتوجيه.
introduction/one-client-entry|إدخال MCP واحد|يضبط العميل http://127.0.0.1:8789/mcp مرة واحدة ويكتشف القدرات ذات namespace. لا يمثل loopback حد ثقة؛ وكل اتصال جديد يحتاج موافقة صريحة على Origin الدقيق.
architecture/components|المكوّنات الأساسية وواجهة macOS الاختيارية|يستخدم العميل MCP القياسي، ويحوّله Node.js Bridge إلى Bridge Protocol مستقل، ثم تنفذ مكتبة Web handlers التصريحية؛ تطبيق macOS يشرف على العملية نفسها فقط.
architecture/responsibility-boundaries|حدود المسؤولية|يمتلك Bridge الجلسات والمصادقة والتوجيه والقيود والمهل وتحويل النتائج؛ يمتلك التطبيق التصريحات والتحقق الدلالي والتنفيذ؛ ويمتلك العميل النية والموافقة.
architecture/request-flow|تدفق الطلب|يحل Bridge القدرة إلى runtime واحد ويرسل invoke مع request ID؛ وتبقى النتيجة والخطأ والمهلة والإلغاء والانفصال مترابطة.
getting-started/prerequisites|المتطلبات|يلزم Node.js 24+ وnpm 11+ وIPv4 loopback ومتصفح حديث وعميل Streamable HTTP؛ يحتاج HTTPS العام شهادة محلية موثوقة، ويحتاج التطبيق الأصلي macOS 14+ وXcode.
getting-started/workspace-setup|تثبيت workspace والتحقق منه|شغّل npm install ثم typecheck وtest وformat:check وbuild من الجذر؛ يعمل الموقع على loopback بلا خدمة خارجية.
getting-started/first-round-trip|إكمال أول رحلة|ابدأ Bridge واطلب الوصول من الموقع، ثم وافق على Origin الدقيق وهوية التطبيق في إدارة Bridge الموثقة. اضبط endpoint MCP وتحقق من Tools وdocs_search.
installing-macos-bridge/build|بناء Bridge متعدد المنصات وتشغيله|توجد النسخة المرجعية في /bridge وتستخدم CLI وإعدادات ونقاطًا وPEM واحدة على macOS وLinux وWindows، ولا تثبت خدمة أو تغيّر الثقة.
installing-macos-bridge/start|بناء تطبيق macOS الأصلي واستخدامه|يدير تطبيق menu-bar غير الموقع Bridge نفسه وNode الخارجي والنقاط وعرض الاعتماد الصريح وطلبات موافقة Origin المعلقة مع Approve/Reject وتوافق legacy token والحالة والسجلات؛ تبقى الأسرار في الذاكرة.
installing-macos-bridge/pair-site|الموافقة على Origin المتصفح|اطلب من الصفحة، وتحقق من scheme وhost وport وهوية التطبيق في إدارة Bridge، ثم اختر Approve أو Reject. لا جلسة ولا تسجيل قبل الموافقة، و--pair-origin للتوافق القديم فقط.
configuring-mcp-client/client-entry|إضافة Bridge المشترك|أنشئ إدخال browsermcp واحدًا بعنوان loopback وMCP bearer لكل تشغيل؛ يختلف عن pairing وadmin tokens.
configuring-mcp-client/verify|التحقق من البدء والاكتشاف|بعد الاقتران حدّث الجلسة وتحقق من Tools وResources وPrompts ذات namespace؛ افحص قوائم Bridge ولوحة الموقع أولًا عند غيابها.
configuring-mcp-client/client-trust|موافقة العميل|لا يلغي الاكتشاف سياسة الموافقة؛ اعتبر descriptions والنتائج بيانات من Origin المقترن وأبقِ موافقة المستخدم وحدود الإدخال.
creating-app/minimal-app|إنشاء تطبيق واتصاله|ثبّت @browsermcp/web وأنشئ instance بهوية مستقرة وسجّل القدرات قبل connect وزامن التغييرات اللاحقة مع Bridge.
creating-app/static-hosting|استخدام الاستضافة الثابتة|تعمل المكتبة مع ESM وbundlers بلا backend خاص؛ يجب أن تستخدم Origins البعيدة HTTPS ويقتصر HTTP العادي على localhost.
creating-app/registration-lifecycle|إدارة التسجيلات|احتفظ بـ RegistrationHandle وانتظر ready عند الحاجة واستدع unregister عند انتهاء السياق؛ يزيل disconnect كل قدرات runtime.
tools/register-tool|تسجيل Tool|يجمع app.tool اسمًا محليًا وdescription وJSON Schema مغلقًا وhandler غير متزامن؛ تحقق من القواعد واذكر الآثار الجانبية.
tools/tool-safety|تصميم Tools آمنة|قيّد الإدخال واحترم AbortSignal وفضّل idempotency ولا تكشف tokens أو credentials أو cross-origin data أو تنفيذ script عشوائي.
tools/site-tools|Tools التي يعرضها الموقع|يعرض الموقع Docs والسياق وruntime وIndexedDB المقيّد بالـOrigin وتحليل Worker محدودًا، بلا تنقل أو code عشوائي.
resources/register-resource|تسجيل Resource|اربط URI ثابتة بقراءة async ذات MIME صحيح؛ كل قراءة لحالة حية snapshot جديد ولا تغيّر الحالة.
resources/site-resources|Resources التوثيق|تعرض URI من browsermcp://docs وbrowsermcp://site الصفحات والحالة واللقطات من المتن الإنجليزي المرجعي المنمط نفسه.
resources/resource-errors|أخطاء Resource|تعيد العناصر الغائبة not-found منظمًا؛ وبعد انفصال runtime تفشل القراءة كـ unavailable ولا يعاد توجيهها.
prompts/register-prompt|تسجيل Prompt|يتحقق app.prompt من arguments وينتج رسائل MCP في المتصفح مع معاملة القيم كبيانات، ولا يتجاوز الصلاحيات.
prompts/site-prompts|Prompts التطوير في الموقع|توجّه prompts الإعداد والتنفيذ والتشخيص ومراجعة الحدود عبر Docs منظمة واستشهاد page/section.
prompts/prompt-safety|أمان Prompt|تبقى arguments غير موثوقة والنتيجة استشارية، ولا تمنح آثارًا جانبية أو تتضمن أسرارًا.
results-errors/success-results|نتائج النجاح|تعيد Tools محتوى MCP وstructuredContent اختياريًا؛ تحافظ Resources وPrompts على أشكالها ويربط request ID الرد.
results-errors/errors|أخطاء التنفيذ والبروتوكول|تتحول الاستثناءات إلى HANDLER_ERROR آمن بلا stack، وتُرفض envelope والإصدار والمصادقة والحجم والمعرفات غير الصالحة قبل handler.
results-errors/timeout-cancel|المهلة والإلغاء|توقف deadline أو cancel إشارة AbortSignal وتتجاهل النتيجة المتأخرة، ولا تعكس أثرًا اكتمل.
connection-lifecycle/state-machine|آلة حالات الاتصال|يفتح connect WebSocket ويتفاوض على version/features ثم يدخل awaiting-approval. لا تُنشأ session وcapabilities ولا يستقبل runtime الـinvoke إلا بعد موافقة مدير Bridge على exact Origin.
connection-lifecycle/reconnect|إعادة اتصال آمنة|تستخدم الخسارة القابلة للمحاولة backoff محدودًا وترسل session proof ما دام صالحًا. تُمسح credential المنتهية أو المرفوضة؛ وعند الحاجة لـsession جديدة يطلب المستخدم الموافقة مجددًا.
connection-lifecycle/disconnect|الانفصال والتنظيف|يغلق disconnect socket ويلغي العمل ويمسح اعتماد الجلسة ويزيل ذريًا قدرات ذلك runtime فقط.
bridge-protocol/separation|الفصل عن MCP القياسي|ينتهي MCP عند Bridge؛ يمثّل البروتوكول الداخلي الاتصال والتسجيل وinvoke والنتائج والإلغاء وheartbeat بلا تمرير MCP خام.
bridge-protocol/envelope|الغلاف والمعرّفات|لكل message إصدار وkind وسياق وpayload محدود؛ يرتبط request ID برد نهائي واحد ويرفض v1 الحقول والأنواع المجهولة.
bridge-protocol/handshake|المصافحة والتفاوض|يتفق الطرفان على version وfeatures. في v1.1 يرسل approval بلا credential ويتلقى approval_required؛ ولا تُنشأ session أو registration إلا بعد موافقة صريحة على exact Origin. يبقى v1.0 لتوافق token/resume.
bridge-protocol/validation|التحقق من الرسائل|يتحقق الطرفان من JSON والحدود وترتيب الحالة أثناء التشغيل؛ تحجب logs الاعتمادات ولا تحفظ أجسام النتائج.
security-model/trust-boundaries|حدود الثقة|عميل MCP وBridge المحلي وOrigin المتصفح جهات منفصلة؛ لا يصادق loopback الصفحة، والمعرفات المعلنة metadata للتوجيه فقط.
security-model/pairing|موافقة مرتبطة بـ Origin|يطلب browser بلا credential. يعرض Bridge request قصيرة وexact Origin في صفحة الإدارة المصادقة؛ لا session ولا registration قبل Approve، ويُغلق الانتظار عند Reject أو expiry.
security-model/input-limits|القيود والرفض|الحجم والتزامن والوقت والأشكال محدودة؛ تفشل الرسائل المجهولة أو غير المصادق عليها أو المشوهة بشكل مغلق.
security-model/known-boundaries|حدود الأمان المعروفة|تعمل القدرة بصلاحيات Origin ولا تتجاوز سياسات المتصفح؛ يلغي v0.1 الصلاحية بالانفصال أو إعادة تشغيل Bridge.
multiple-applications/identity|هوية التطبيق وruntime|Origin المرصود هو principal، أما app/runtime/instance فهي routing metadata معلنة؛ افصل التطبيقات غير الموثوقة بـOrigins مختلفة.
multiple-applications/namespacing|الأسماء والتعارض|يفصل namespace الأسماء المحلية بين التطبيقات؛ يسبب المزود المكرر غموضًا ويُحظر last-writer-wins.
multiple-applications/runtime-selection|اختيار runtime وإزالته|لا يختار v0.1 instance، لذا أبقِ مزودًا واحدًا، وعند الانفصال أزل ذلك runtime فقط بلا إعادة توجيه صامتة.
api-reference/browsermcp|فئة BrowserMCP|تمتلك الفئة التسجيلات والحالة والطلبات والسجلات والتنظيف؛ استخدم API والأحداث العامة لا تفاصيل الرسائل الداخلية.
api-reference/registration-types|تعريفات Tool وResource وPrompt|تجمع التعريفات المنمطة metadata وschemas وhandlers async؛ الأسماء وURI ثابتة والتكرار مرفوض.
api-reference/connection-types|أنواع الاتصال والتشخيص|تحدد Options العنوان والهوية وإعادة الاتصال والمهل وانتظار الموافقة وstore وLNA. يحدد ConnectOptions سياسة الطلب وlegacy token اختياريًا؛ تعرض snapshot حالة awaiting-approval وبيانات الطلب غير السرية.
api-reference/protocol-types|أنواع البروتوكول داخلية|@browsermcp/protocol للمنفذين، بينما تستخدم التطبيقات @browsermcp/web ولا ترسل رسائل خامًا.
bridge-configuration/network|نقاط الشبكة|يشترك MCP والمتصفح في 127.0.0.1:8789؛ host ثابت وأي port جديد يجب ضبطه في العميل والصفحة.
bridge-configuration/https-site|موقع HTTPS وWSS محلي|استخدم شهادة SAN لـ127.0.0.1 وwss/https؛ اطلب الوصول ووافق على Origin الدقيق في Bridge. ثق بالـCA المحلية فقط واستخدم health بلا اعتماد لـLNA، ولا تخفّض HTTPS إلى ws.
bridge-configuration/limits|حدود الطلبات|payload والتزامن والمهلة وidle وping محدودة؛ زيادتها ترفع المخاطر ولا تستبدل Tool schema.
bridge-configuration/secrets-logs|الموافقة والسجلات|طلبات Origin المعلقة محدودة وتنتهي؛ ولا تنشأ legacy tokens إلا عند الطلب. logs محدودة وتحجب الحقول المعروفة وAuthorization وأسرار URL ولا تحفظ result body.
troubleshooting/diagnostic-order|ترتيب التشخيص|افحص health والنقاط وOrigin والمصادقة والتفاوض والجلسة والتسجيل والتوجيه قبل handler، واربط request ID بلا كشف token.
troubleshooting/bridge-not-connected|Bridge غير متصل|ميّز listener الغائب والصفحة غير المقترنة والجلسة المنتهية وفشل التسجيل بالحالة والخطأ الآمن؛ AUTH_REQUIRED code خطأ.
troubleshooting/origin-error|رفض Origin|قارن scheme وhost وport بدقة مع الطلب المعلق في Bridge، واطلب مجددًا ووافق على Origin الدقيق فقط؛ لا تستخدم '*' أو تعطّل التحقق.
troubleshooting/authentication-error|فشل المصادقة|يعني APPROVAL_REJECTED أن الطلب رُفض؛ وعند APPROVAL_EXPIRED أبقِ الصفحة مفتوحة وأعد الطلب. يتطلب AUTH_INVALID القديم أو SESSION_RESUME_REJECTED موافقة جديدة أو token متوافقًا؛ لا تسجل credential.
troubleshooting/name-conflict|تعارض اسم capability|افحص المرشحين وأغلق علامات التبويب المكررة؛ لا يختار v0.1 instance ويرفض الغموض.
troubleshooting/version-mismatch|عدم تطابق إصدار البروتوكول|قارن الإصدارات وابنِ من checkout واحد وحدّث المكوّن الأقدم، ولا تفرض التوافق.
development/workspace|بنية workspace|ابقِ protocol وweb وBridge وmacOS shell وsite وtests وdocs منفصلة مع Node 24+ وESM وTypeScript strict ومسارات محايدة.
development/site-architecture|معمارية الموقع|تستخدم UI وMCP متنًا إنجليزيًا منمطًا وفهرسًا منظمًا؛ يضيف i18n ترجمة بلا تغيير IDs أو routes أو controller.
development/github-pages-build|بناء subpath لـGitHub Pages|يشغّل .github/workflows/pages.yml الأمر npm run check على main، ويعيد البناء باستخدام base_path وينشر site/dist فقط. يبقى HTTPS بحاجة إلى CA/WSS محليين وhealth بلا credential وإذن LNA وموافقة exact Origin في Bridge.
development/quality-gates|بوابات الجودة|يلزم format وtypecheck وunit وintegration وbuild؛ وثّق بيئة وفِعل ونتيجة وحدود الفحوص اليدوية.
development/contributing|قواعد المساهمة|ضع المنطق العام في protocol/Bridge ومنطق التطبيق في المتصفح، وحدّث Docs/tests ولا تنشر أسرارًا أو output نشر.
roadmap/implemented|المنفذ في المستودع|يتضمن protocol منمطًا وWeb library وBridge محمولًا وتطبيق macOS وموقع Vite وDocs MCP واختبارات بحالة كل section.
roadmap/verification-status|حالة التحقق الواقعي|اجتاز GitHub Pages run 29643866925 جميع quality gate ونشر https://masashi-desu.github.io/BrowserMCP/. نجح في Chrome معزول إذن LNA ضمن context وloopback TLS Bridge وموافقة exact Origin وتسجيل 19/23/4 واستدعاء docs_get_section من MCP SDK الرسمي. تجاهل context أخطاء loopback TLS، لذلك لم يُتحقق بعد من CA trust اليدوي في OS أو permission UI التفاعلية أو Safari وEdge وFirefox.
roadmap/distribution|التوزيع والمنصات الأخرى|يُنشر Docs site من main إلى GitHub Pages؛ يبقى npm وReleases وApp Store والتوقيع وnotarization خارج النطاق، والمنصات الأخرى تحتاج تحققًا لاحقًا.
roadmap/security-hardening|تعزيز الأمان مستقبلًا|يُطبق loopback والاقتران والتحقق والقيود والحجب؛ تبقى المراجعة الخارجية وتخزين الإصدار وconsent/audit الأدق لاحقًا.
roadmap/known-constraints|القيود المعروفة|تم التحقق من Apple Silicon macOS فقط؛ يحتاج التطبيق Node خارجيًا وتبقى قواعد المتصفح، ولا يوجد cloud relay أو remote browser transport.`,
);

const ptBR = catalog(
  `introduction|Por que o BrowserMCP usa o navegador como runtime MCP.
architecture|Componentes, limites de confiança e roteamento de solicitações.
getting-started|Caminho mais curto do checkout à primeira capacidade do navegador.
installing-macos-bridge|Execução do Bridge multiplataforma e supervisão opcional pelo app macOS.
configuring-mcp-client|Um endpoint Streamable HTTP para todos os apps conectados.
creating-app|Integração da biblioteca Web e declaração de capacidades do navegador.
tools|Operações executáveis no navegador descritas por schema.
resources|Conteúdo endereçável do navegador e da documentação sem semântica de execução.
prompts|Fluxos de desenvolvimento reutilizáveis orientados por argumentos.
results-errors|Resultados, falhas, erros de transporte, timeout e cancelamento.
connection-lifecycle|Pareamento, sessão, sincronização, reconexão e encerramento.
bridge-protocol|Protocolo interno tipado e versionado entre Bridge e navegador.
security-model|Limites de confiança, pareamento por Origin, limites e segredos.
multiple-applications|Identidade, namespaces, abas, conflitos e roteamento determinístico.
api-reference|APIs e tipos públicos do BrowserMCP para apps Web.
bridge-configuration|Endpoints loopback, política de Origin, limites e logs.
troubleshooting|Diagnóstico baseado em evidências de conexão, autenticação e routing.
development|Workspace, arquitetura do site, controles de qualidade e contribuição.
roadmap|Escopo implementado, trabalho planejado e restrições conhecidas.`,
  `introduction/problem|O problema resolvido pelo BrowserMCP|O BrowserMCP evita duplicar lógica Web em servidores MCP separados: a execução permanece no navegador e um Bridge genérico publica as capacidades sem incorporar regras de negócio.
introduction/browser-runtime|O navegador é o runtime MCP|Handlers rodam junto de JavaScript, Workers, WASM, IndexedDB, Canvas e Web APIs; o Bridge apenas autentica e roteia.
introduction/one-client-entry|Uma entrada no cliente MCP|O cliente configura http://127.0.0.1:8789/mcp uma vez e descobre capacidades com namespace. Loopback não é fronteira de confiança; cada nova conexão exige aprovação explícita do Origin exato.
architecture/components|Componentes principais e shell macOS opcional|O cliente usa MCP padrão, o Bridge Node.js converte para o BrowserMCP Bridge Protocol e a biblioteca Web chama handlers declarativos; o app macOS só supervisiona o mesmo processo.
architecture/responsibility-boundaries|Limites de responsabilidade|O Bridge cuida de sessões, autenticação, routing, limites, timeout e conversão; o app cuida das declarações, validação semântica e execução; o cliente cuida da intenção e aprovação.
architecture/request-flow|Fluxo de solicitações|O Bridge resolve a capacidade para um runtime, cria request ID e encaminha invoke; resultado, erro, timeout, cancelamento e desconexão permanecem correlacionados.
getting-started/prerequisites|Pré-requisitos|São necessários Node.js 24+, npm 11+, loopback IPv4, navegador atual e cliente Streamable HTTP; HTTPS público exige certificado local confiável e o app nativo exige macOS 14+ e Xcode.
getting-started/workspace-setup|Instalar e validar o workspace|Execute npm install e depois typecheck, test, format:check e build na raiz; o site inicia em loopback sem serviço externo.
getting-started/first-round-trip|Concluir a primeira chamada|Inicie o Bridge, solicite acesso pelo site e aprove o Origin exato e a identidade do app na administração autenticada. Configure o endpoint MCP para listar Tools e chamar docs_search.
installing-macos-bridge/build|Compilar e executar o Bridge multiplataforma|O Bridge canônico fica em /bridge e usa o mesmo CLI, configuração, endpoints e PEM no macOS, Linux e Windows; não instala serviços nem altera confiança.
installing-macos-bridge/start|Compilar e usar o app nativo macOS|O app não assinado da barra de menus gerencia o mesmo Bridge, Node externo, endpoints, credenciais explícitas, aprovações de Origin pendentes com Approve/Reject, compatibilidade legacy de token, estado e logs; segredos ficam em memória.
installing-macos-bridge/pair-site|Aprovar um Origin do navegador|Solicite pela página, confira scheme, host, port e identidade no Bridge e escolha Approve ou Reject. Antes da aprovação não há sessão nem registros; --pair-origin é apenas compatibilidade legada.
configuring-mcp-client/client-entry|Adicionar o Bridge comum|Crie uma única entrada browsermcp com Streamable HTTP, URL loopback e MCP bearer de cada inicialização; pairing e admin tokens são diferentes.
configuring-mcp-client/verify|Verificar inicialização e descoberta|Depois do pareamento, atualize a sessão e confira Tools, Resources e Prompts com namespace; se faltarem, veja primeiro as listas do Bridge e o painel do site.
configuring-mcp-client/client-trust|Aprovação pelo cliente|A descoberta não substitui a política de aprovação: trate descriptions e resultados como dados do Origin pareado e mantenha aprovação e limites.
creating-app/minimal-app|Criar e conectar um app|Instale @browsermcp/web, crie uma instância com identidade estável, registre capacidades antes de connect e sincronize alterações posteriores.
creating-app/static-hosting|Usar hospedagem estática|A biblioteca funciona com ESM e bundlers sem backend próprio; Origins remotos devem usar HTTPS e HTTP simples fica restrito ao localhost.
creating-app/registration-lifecycle|Gerenciar registros|Guarde RegistrationHandle, aguarde ready quando necessário e chame unregister ao perder validade; disconnect remove todas as capacidades do runtime.
tools/register-tool|Registrar uma Tool|app.tool combina nome local, description, JSON Schema fechado e handler async; valide regras semânticas e declare efeitos colaterais.
tools/tool-safety|Projetar Tools seguras|Limite inputs, respeite AbortSignal, prefira idempotência e não exponha tokens, credenciais, dados cross-origin nem script arbitrário.
tools/site-tools|Tools expostas por este site|O site oferece Docs, contexto, runtime, IndexedDB limitado ao Origin e análise Worker com limites, sem navegação ou code arbitrários.
resources/register-resource|Registrar um Resource|Mapeie URI estável para leitura async com MIME correto; cada leitura de estado vivo é snapshot novo e não altera estado.
resources/site-resources|Resources de documentação|URIs browsermcp://docs e browsermcp://site expõem páginas, status e snapshots a partir do mesmo corpus inglês tipado e canônico.
resources/resource-errors|Erros de Resource|Itens ausentes retornam not-found estruturado; após desconexão, leituras ficam unavailable e não são roteadas para outro runtime.
prompts/register-prompt|Registrar um Prompt|app.prompt valida arguments e produz mensagens MCP no navegador, tratando valores como dados e sem contornar permissões.
prompts/site-prompts|Prompts de desenvolvimento do site|Os prompts orientam instalação, implementação, diagnóstico e revisão de limites usando Docs estruturados e citações page/section.
prompts/prompt-safety|Segurança de Prompt|Arguments continuam não confiáveis, a saída é consultiva e não autoriza efeitos nem inclui segredos.
results-errors/success-results|Resultados de sucesso|Tools retornam MCP content e structuredContent opcional; Resources e Prompts mantêm seus shapes e request ID correlaciona a resposta.
results-errors/errors|Erros de execução e protocolo|Exceções viram HANDLER_ERROR seguro sem stack; envelope, versão, autenticação, tamanho e ID inválidos são recusados antes do handler.
results-errors/timeout-cancel|Timeout e cancelamento|Deadline ou cancel aborta o AbortSignal e ignora resultado tardio; não desfaz efeito já concluído.
connection-lifecycle/state-machine|Máquina de estados da conexão|connect abre WebSocket, negocia version/features e entra em awaiting-approval. Somente após o administrador aprovar o Origin exato a session e as capabilities são criadas e o runtime connected recebe invoke.
connection-lifecycle/reconnect|Reconectar com segurança|Perda recuperável usa backoff limitado e apresenta session proof apenas enquanto válido. Credential expirada ou rejeitada é removida; quando uma nova session for necessária, a pessoa solicita aprovação novamente. Store persistente protege credential e identidade.
connection-lifecycle/disconnect|Desconectar e limpar|disconnect fecha socket, aborta trabalho, apaga credenciais de sessão e remove atomicamente só as capacidades daquele runtime.
bridge-protocol/separation|Separação do MCP padrão|MCP termina no Bridge; o protocolo interno representa conexão, registro, invoke, resultado, cancelamento e heartbeat sem transportar MCP bruto.
bridge-protocol/envelope|Envelope e identificadores|Cada message tem versão, kind, contexto e payload limitado; request ID liga uma resposta terminal e v1 recusa campos e kinds desconhecidos.
bridge-protocol/handshake|Handshake e negociação|As partes acordam version e features. No v1.1, approval não leva credential e recebe approval_required; session e registro só existem após aprovação explícita do Origin exato. O v1.0 permanece para compatibilidade token/resume.
bridge-protocol/validation|Validação de mensagens|Os dois endpoints validam JSON, limites e ordem de estado em runtime; logs ocultam credenciais e não armazenam corpos de resultados.
security-model/trust-boundaries|Limites de confiança|Cliente MCP, Bridge local e Origin são principals separados; loopback não autentica páginas e IDs declarados são apenas metadata de routing.
security-model/pairing|Aprovação vinculada ao Origin|O browser solicita sem credential. O Bridge mostra uma request curta e o Origin exato na administração autenticada; não cria session nem registros antes de Approve, e Reject ou expiry encerram a espera. Projetos OWNER.github.io compartilham Origin.
security-model/input-limits|Limites e rejeição|Tamanho, concorrência, tempo e shapes são finitos; mensagens desconhecidas, não autenticadas ou malformadas falham de forma fechada.
security-model/known-boundaries|Limites de segurança conhecidos|A capacidade usa privilégios do Origin e não contorna políticas do navegador; v0.1 revoga por desconexão ou reinício.
multiple-applications/identity|Identidade de aplicação e runtime|Origin observado é o principal; app/runtime/instance são routing metadata declaradas e apps não confiáveis devem usar Origins distintos.
multiple-applications/namespacing|Nomes e colisões|O namespace separa nomes locais entre apps; providers duplicados geram ambiguidade e last-writer-wins é proibido.
multiple-applications/runtime-selection|Seleção e remoção de runtime|v0.1 não seleciona instance; mantenha um provider e, ao desconectar, remova só aquele runtime sem rerouting silencioso.
api-reference/browsermcp|Classe BrowserMCP|A classe possui registros, estado, requests, logs e cleanup; use APIs/eventos públicos, não detalhes internos das mensagens.
api-reference/registration-types|Definições de Tool, Resource e Prompt|Definições tipadas unem metadata, schemas e handlers async; nomes e URIs são estáveis e duplicatas são recusadas.
api-reference/connection-types|Tipos de conexão e diagnóstico|Options controla URL, identidade, reconexão, timeouts, espera de aprovação, store e LNA. ConnectOptions controla a solicitação e token legado opcional; snapshot mostra awaiting-approval e dados não secretos.
api-reference/protocol-types|Tipos de protocolo são internos|@browsermcp/protocol é para implementadores; apps normais usam @browsermcp/web e não enviam mensagens brutas.
bridge-configuration/network|Endpoints de rede|MCP e browser compartilham 127.0.0.1:8789; host é fixo e mudança de port deve aparecer no cliente e na página.
bridge-configuration/https-site|Site HTTPS e WSS local|Use certificado SAN para 127.0.0.1 e wss/https; solicite acesso e aprove o Origin exato no Bridge. Confie apenas na CA local e use health sem credencial para LNA; nunca rebaixe HTTPS para ws.
bridge-configuration/limits|Limites de solicitações|Payload, concorrência, deadline, idle e ping são finitos; aumentá-los eleva risco e não substitui Tool schema.
bridge-configuration/secrets-logs|Aprovação e logs|Solicitações pendentes são limitadas e expiram; só tokens legados são gerados sob demanda. Logs limitados ocultam campos conhecidos, Authorization e segredos de URL e não guardam result body.
troubleshooting/diagnostic-order|Ordem de diagnóstico|Verifique health, endpoints, Origin, auth, negociação, sessão, registros e routing antes do handler; correlacione request ID sem expor token.
troubleshooting/bridge-not-connected|Bridge não conectado|Diferencie listener ausente, página sem pairing, sessão vencida e registro falho pelo estado e erro seguro; AUTH_REQUIRED é código.
troubleshooting/origin-error|Origin rejeitado|Compare scheme, host e port com a solicitação pendente do Bridge, solicite novamente e aprove só o Origin exato; não use '*' nem desative validação.
troubleshooting/authentication-error|Falha de autenticação|APPROVAL_REJECTED indica rejeição; em APPROVAL_EXPIRED mantenha a aba aberta e solicite de novo. AUTH_INVALID legado ou SESSION_RESUME_REJECTED exige nova aprovação ou token compatível; não registre credenciais.
troubleshooting/name-conflict|Conflito de nome|Veja candidatos e feche abas duplicadas; v0.1 não seleciona instance e recusa ambiguidade.
troubleshooting/version-mismatch|Versão de protocolo incompatível|Compare versões, compile do mesmo checkout e atualize o componente antigo; não force compatibilidade.
development/workspace|Estrutura do workspace|Mantenha protocol, web, Bridge, shell macOS, site, tests e docs separados com Node 24+, ESM, TypeScript strict e paths neutros.
development/site-architecture|Arquitetura do site|UI e MCP usam corpus inglês tipado e índice estruturado; i18n sobrepõe tradução sem mudar IDs, routes ou controller.
development/github-pages-build|Build para subpath do GitHub Pages|.github/workflows/pages.yml executa npm run check em main, recompila com o base_path do Pages e publica apenas site/dist. O site HTTPS ainda exige CA/WSS local, health sem credential, permissão LNA e aprovação do Origin exato no Bridge.
development/quality-gates|Controles de qualidade|Format, typecheck, unit, integration e build são obrigatórios; checks manuais registram ambiente, passos, resultado esperado e limites.
development/contributing|Regras de contribuição|Mantenha lógica genérica em protocol/Bridge e lógica de app no browser; sincronize Docs/tests e não publique segredos ou output de deploy.
roadmap/implemented|Implementado neste repositório|Há protocol tipado, Web library, Bridge portátil, app macOS, site Vite, Docs MCP e tests com status por section.
roadmap/verification-status|Estado da verificação real|O GitHub Pages run 29643866925 passou por todas as quality gates e publicou https://masashi-desu.github.io/BrowserMCP/. Em um Chrome isolado, funcionaram a permissão LNA limitada ao context, o loopback TLS Bridge, a aprovação do exact Origin, o registro 19/23/4 e a chamada docs_get_section pelo MCP SDK oficial. Como o context ignorou erros TLS de loopback, o CA trust manual no OS, a permission UI interativa, Safari, Edge e Firefox ainda não foram verificados.
roadmap/distribution|Distribuição e outras plataformas|O site Docs é publicado no GitHub Pages a partir de main; npm, Releases, App Store, assinatura e notarização ficam fora. Outras plataformas precisam de validação futura.
roadmap/security-hardening|Reforço futuro de segurança|Loopback, pairing, validação, limites e redaction já existem; revisão externa, storage de release e consent/audit detalhados ficam para depois.
roadmap/known-constraints|Restrições conhecidas|Somente Apple Silicon macOS foi verificado; o app nativo exige Node externo e regras do navegador continuam válidas, sem cloud relay ou remote browser.`,
);

const ru = catalog(
  `introduction|Почему BrowserMCP использует браузер как среду выполнения MCP.
architecture|Компоненты, границы доверия и маршрутизация запросов.
getting-started|Кратчайший путь от checkout до первой возможности браузера.
installing-macos-bridge|Запуск кроссплатформенного Bridge и управление через приложение macOS.
configuring-mcp-client|Один endpoint Streamable HTTP для всех подключённых приложений.
creating-app|Подключение Web-библиотеки и объявление возможностей браузера.
tools|Операции с описанной schema, выполняемые в браузере.
resources|Адресуемое содержимое браузера и документации без семантики выполнения.
prompts|Повторно используемые сценарии разработки с аргументами.
results-errors|Результаты, ошибки выполнения и транспорта, timeout и отмена.
connection-lifecycle|Pairing, сессия, синхронизация, переподключение и завершение.
bridge-protocol|Типизированный версионируемый внутренний протокол Bridge и браузера.
security-model|Границы доверия, pairing по Origin, ограничения и секреты.
multiple-applications|Идентичность, namespaces, вкладки, конфликты и детерминированный routing.
api-reference|Публичные API и типы BrowserMCP для Web-приложений.
bridge-configuration|Loopback endpoints, политика Origin, лимиты и журналы.
troubleshooting|Диагностика подключения, аутентификации, версии и routing по фактам.
development|Workspace, архитектура сайта, проверки качества и границы вкладов.
roadmap|Реализованный объём, планы и известные ограничения.`,
  `introduction/problem|Проблема, которую решает BrowserMCP|BrowserMCP не дублирует Web-логику в отдельном MCP server: выполнение остаётся в браузере, а общий локальный Bridge публикует возможности без бизнес-логики приложения.
introduction/browser-runtime|Браузер — среда MCP|Handlers работают рядом с JavaScript, Workers, WASM, IndexedDB, Canvas и Web APIs; Bridge только аутентифицирует и маршрутизирует.
introduction/one-client-entry|Одна запись MCP-клиента|Клиент один раз настраивает http://127.0.0.1:8789/mcp и видит namespaced возможности. Loopback не является границей доверия; каждое новое подключение требует явного одобрения точного Origin.
architecture/components|Основные компоненты и оболочка macOS|Клиент использует стандартный MCP, Node.js Bridge переводит его в отдельный Bridge Protocol, Web-библиотека вызывает декларативные handlers, а приложение macOS лишь контролирует тот же процесс.
architecture/responsibility-boundaries|Границы ответственности|Bridge отвечает за sessions, auth, routing, limits, timeout и преобразование; приложение — за объявления, смысловую проверку и выполнение; клиент — за намерение и approval.
architecture/request-flow|Поток запроса|Bridge разрешает возможность в один runtime, создаёт request ID и передаёт invoke; result, error, timeout, cancel и disconnect остаются связанными.
getting-started/prerequisites|Требования|Нужны Node.js 24+, npm 11+, IPv4 loopback, актуальный браузер и клиент Streamable HTTP; публичному HTTPS нужен доверенный локальный сертификат, нативному приложению — macOS 14+ и Xcode.
getting-started/workspace-setup|Установка и проверка workspace|Выполните npm install, затем typecheck, test, format:check и build в корне; site запускается на loopback без внешнего сервиса.
getting-started/first-round-trip|Первый полный вызов|Запустите Bridge, запросите доступ с сайта и одобрите точный Origin и identity приложения в аутентифицированном управлении Bridge. Настройте MCP endpoint для списка Tools и docs_search.
installing-macos-bridge/build|Сборка и запуск кроссплатформенного Bridge|Канонический Bridge находится в /bridge и применяет одинаковые CLI, настройки, endpoints и PEM на macOS, Linux и Windows; он не ставит службы и не меняет trust.
installing-macos-bridge/start|Сборка и использование нативного приложения macOS|Неподписанное menu-bar приложение управляет тем же Bridge, внешним Node, endpoints, явным показом credentials, ожидающими одобрения точного Origin с Approve/Reject, совместимостью legacy token, состоянием и logs; секреты хранятся в памяти.
installing-macos-bridge/pair-site|Одобрение Origin браузера|Запросите доступ со страницы, проверьте точные scheme, host, port и identity в Bridge, затем выберите Approve или Reject. До одобрения нет session и registrations; --pair-origin оставлен для legacy-совместимости.
configuring-mcp-client/client-entry|Добавление общего Bridge|Создайте одну запись browsermcp с Streamable HTTP, loopback URL и MCP bearer каждого запуска; pairing и admin tokens отличаются.
configuring-mcp-client/verify|Проверка инициализации и обнаружения|После pairing обновите session и проверьте namespaced Tools, Resources и Prompts; при отсутствии сначала смотрите списки Bridge и панель site.
configuring-mcp-client/client-trust|Одобрение клиентом|Discovery не заменяет approval policy: считайте descriptions и results данными paired Origin и сохраняйте подтверждение пользователя и лимиты.
creating-app/minimal-app|Создание и подключение приложения|Установите @browsermcp/web, создайте instance со стабильной identity, зарегистрируйте возможности до connect и синхронизируйте последующие изменения.
creating-app/static-hosting|Статический hosting|Библиотека работает с ESM и bundlers без своего backend; удалённые Origins обязаны использовать HTTPS, обычный HTTP разрешён лишь localhost.
creating-app/registration-lifecycle|Управление регистрациями|Храните RegistrationHandle, ждите ready при необходимости и вызывайте unregister при потере актуальности; disconnect удаляет все возможности runtime.
tools/register-tool|Регистрация Tool|app.tool объединяет local name, description, закрытую JSON Schema и async handler; проверяйте смысловые правила и описывайте side effects.
tools/tool-safety|Безопасные Tools|Ограничивайте inputs, учитывайте AbortSignal, предпочитайте idempotency и не раскрывайте tokens, credentials, cross-origin data или произвольный script.
tools/site-tools|Tools этого сайта|Site предоставляет Docs, context, runtime, Origin-scoped IndexedDB и ограниченный Worker analysis без произвольной навигации или code.
resources/register-resource|Регистрация Resource|Свяжите стабильную URI с async-чтением и точным MIME; каждое чтение живого состояния — новый snapshot и не меняет состояние.
resources/site-resources|Resources документации|URI browsermcp://docs и browsermcp://site отдают pages, status и snapshots из одного типизированного канонического английского корпуса.
resources/resource-errors|Ошибки Resource|Отсутствующее возвращает структурированный not-found; после disconnect чтение unavailable и не перенаправляется другому runtime.
prompts/register-prompt|Регистрация Prompt|app.prompt проверяет arguments и создаёт MCP messages в браузере, рассматривая значения как данные и не обходя permissions.
prompts/site-prompts|Prompts разработки сайта|Prompts направляют setup, implementation, diagnosis и review границ через структурированные Docs и ссылки page/section.
prompts/prompt-safety|Безопасность Prompt|Arguments остаются недоверенными, ответ — рекомендацией, он не разрешает side effects и не содержит секретов.
results-errors/success-results|Успешные результаты|Tools возвращают MCP content и необязательный structuredContent; Resources и Prompts сохраняют стандартные shapes, request ID связывает ответ.
results-errors/errors|Ошибки выполнения и протокола|Исключения нормализуются в безопасный HANDLER_ERROR без stack; неверные envelope, version, auth, size и ID отклоняются до handler.
results-errors/timeout-cancel|Timeout и отмена|Deadline или cancel прерывает AbortSignal и игнорирует поздний result; уже завершённый side effect не откатывается.
connection-lifecycle/state-machine|Автомат состояний подключения|connect открывает WebSocket, согласует version/features и переходит в awaiting-approval. Session и capabilities создаются, а connected runtime получает invoke только после одобрения exact Origin администратором Bridge.
connection-lifecycle/reconnect|Безопасное переподключение|Восстановимая потеря использует ограниченный backoff и session proof только пока он действителен. Просроченная или отклонённая credential удаляется; для новой session пользователь снова запрашивает одобрение.
connection-lifecycle/disconnect|Отключение и очистка|disconnect закрывает socket, отменяет работу, удаляет session credentials и атомарно снимает возможности только этого runtime.
bridge-protocol/separation|Отделение от стандартного MCP|MCP завершается в Bridge; внутренний протокол моделирует connect, register, invoke, result, cancel и heartbeat без туннеля raw MCP.
bridge-protocol/envelope|Envelope и идентификаторы|Каждый message имеет version, kind, context и ограниченный payload; request ID связан с одним terminal response, v1 отвергает неизвестное.
bridge-protocol/handshake|Handshake и согласование|Стороны согласуют version и features. В v1.1 approval идёт без credential и получает approval_required; session и registration возникают только после явного одобрения exact Origin. v1.0 остаётся для совместимости token/resume.
bridge-protocol/validation|Проверка сообщений|Обе стороны проверяют JSON, limits и порядок state в runtime; logs скрывают credentials и не содержат result bodies.
security-model/trust-boundaries|Границы доверия|MCP client, local Bridge и browser Origin — разные principals; loopback не аутентифицирует страницы, declared IDs — лишь routing metadata.
security-model/pairing|Одобрение с привязкой к Origin|browser запрашивает доступ без credential. Bridge показывает короткоживущий request и exact Origin в аутентифицированной админке; до Approve нет session и registration, Reject или expiry закрывают ожидание.
security-model/input-limits|Лимиты и отказ|Размер, concurrency, time и shapes конечны; неизвестные, неаутентифицированные или malformed сообщения fail closed.
security-model/known-boundaries|Известные границы безопасности|Возможность работает с правами Origin и не обходит политики браузера; v0.1 отзывает полномочия через disconnect или restart.
multiple-applications/identity|Идентичность приложения и runtime|Наблюдаемый Origin — principal; app/runtime/instance — заявленная routing metadata, недоверенные приложения требуют разных Origins.
multiple-applications/namespacing|Имена и конфликты|Namespace разделяет local names приложений; дублированные providers создают ambiguity, last-writer-wins запрещён.
multiple-applications/runtime-selection|Выбор и удаление runtime|v0.1 не выбирает instance: оставьте одного provider; disconnect удаляет только его без скрытого rerouting.
api-reference/browsermcp|Класс BrowserMCP|Класс владеет registrations, state, requests, logs и cleanup; используйте public API/events, а не внутренние message details.
api-reference/registration-types|Определения Tool, Resource и Prompt|Типизированные определения объединяют metadata, schemas и async handlers; стабильные names/URI не допускают дубликатов.
api-reference/connection-types|Типы подключения и диагностики|Options задаёт URL, identity, reconnect, timeout, ожидание одобрения, store и LNA. ConnectOptions задаёт политику запроса и необязательный legacy token; snapshot показывает awaiting-approval и несекретные данные запроса.
api-reference/protocol-types|Типы протокола внутренние|@browsermcp/protocol предназначен разработчикам реализации; приложения используют @browsermcp/web и не отправляют raw messages.
bridge-configuration/network|Сетевые endpoints|MCP и browser делят 127.0.0.1:8789; host фиксирован, изменение port должно быть в клиенте и странице.
bridge-configuration/https-site|HTTPS-сайт и локальный WSS|Используйте SAN-сертификат 127.0.0.1 и wss/https; запросите доступ и одобрите точный Origin в Bridge. Доверяйте только локальному CA и используйте health без credentials для LNA; не понижайте HTTPS до ws.
bridge-configuration/limits|Лимиты запросов|Payload, concurrency, deadline, idle и ping конечны; повышение увеличивает риск и не заменяет Tool schema.
bridge-configuration/secrets-logs|Одобрение и logs|Ожидающие Origin-запросы ограничены и истекают; legacy tokens создаются только по запросу. Ограниченные logs скрывают известные поля, Authorization и URL secrets и не хранят result body.
troubleshooting/diagnostic-order|Порядок диагностики|Проверьте health, endpoints, Origin, auth, negotiation, session, registration и routing до handler; связывайте request ID без token.
troubleshooting/bridge-not-connected|Bridge не подключён|Отличайте отсутствующий listener, unpaired page, expired session и failed registration по state и safe error; AUTH_REQUIRED — code.
troubleshooting/origin-error|Origin отклонён|Точно сравните scheme, host и port с ожидающим запросом Bridge, запросите снова и одобрите только точный Origin; не применяйте '*' или отключение validation.
troubleshooting/authentication-error|Ошибка аутентификации|APPROVAL_REJECTED означает отказ; при APPROVAL_EXPIRED держите вкладку открытой и запросите снова. Legacy AUTH_INVALID или SESSION_RESUME_REJECTED требует нового одобрения или совместимого token; не записывайте credential.
troubleshooting/name-conflict|Конфликт имени capability|Проверьте кандидатов и закройте дублирующие вкладки; v0.1 не выбирает instance и отклоняет ambiguity.
troubleshooting/version-mismatch|Несовпадение версии протокола|Сравните versions, соберите один checkout и обновите старый component; не принуждайте совместимость.
development/workspace|Структура workspace|Разделяйте protocol, web, Bridge, macOS shell, site, tests и docs с Node 24+, ESM, strict TypeScript и OS-neutral paths.
development/site-architecture|Архитектура сайта|UI и MCP используют типизированный английский корпус и структурный index; i18n накладывает перевод без изменения IDs, routes и controller.
development/github-pages-build|Сборка subpath GitHub Pages|.github/workflows/pages.yml запускает npm run check в main, пересобирает с base_path Pages и публикует только site/dist. Для HTTPS всё ещё нужны local CA/WSS, health без credential, разрешение LNA и одобрение exact Origin в Bridge.
development/quality-gates|Проверки качества|Обязательны format, typecheck, unit, integration и build; ручные проверки фиксируют environment, steps, expected result и limits.
development/contributing|Правила вкладов|Общая логика остаётся в protocol/Bridge, логика приложения — в browser; синхронизируйте Docs/tests и не публикуйте secrets или deploy output.
roadmap/implemented|Реализовано в репозитории|Есть typed protocol, Web library, portable Bridge, macOS app, Vite site, Docs MCP и tests со status разделов.
roadmap/verification-status|Статус реальной проверки|GitHub Pages run 29643866925 прошёл все quality gate и развернул https://masashi-desu.github.io/BrowserMCP/. В изолированном Chrome успешно проверены разрешение LNA в рамках context, loopback TLS Bridge, одобрение exact Origin, регистрация 19/23/4 и вызов docs_get_section из официального MCP SDK. Поскольку context игнорировал loopback TLS error, ручной CA trust в OS, интерактивный permission UI, Safari, Edge и Firefox ещё не проверены.
roadmap/distribution|Распространение и платформы|Docs site публикуется в GitHub Pages из main; npm, Releases, App Store, подпись и notarization вне scope. Другим платформам нужна будущая проверка.
roadmap/security-hardening|Будущее усиление безопасности|Loopback, pairing, validation, limits и redaction уже действуют; внешний review, release storage и более точный consent/audit остаются впереди.
roadmap/known-constraints|Известные ограничения|Проверен только Apple Silicon macOS; native app требует внешний Node и подчиняется правилам браузера, cloud relay и remote browser отсутствуют.`,
);

const bn = catalog(
  `introduction|BrowserMCP কেন browser-কে MCP runtime হিসেবে ব্যবহার করে।
architecture|উপাদান, trust boundary ও request routing।
getting-started|checkout থেকে প্রথম browser capability পর্যন্ত সংক্ষিপ্ত পথ।
installing-macos-bridge|cross-platform Bridge চালানো ও ঐচ্ছিক macOS app দিয়ে পরিচালনা।
configuring-mcp-client|সব সংযুক্ত browser app-এর জন্য একটি Streamable HTTP endpoint।
creating-app|Web library যোগ করা ও browser capability ঘোষণা।
tools|schema-বর্ণিত, browser-এ চালিত operation।
resources|execution ছাড়া addressable browser ও documentation content।
prompts|argument-চালিত পুনর্ব্যবহারযোগ্য development workflow।
results-errors|result, execution failure, transport error, timeout ও cancellation।
connection-lifecycle|pairing, session, capability sync, reconnect ও cleanup।
bridge-protocol|Bridge ও browser-এর typed, versioned internal protocol।
security-model|trust boundary, Origin-bound pairing, limit ও secret handling।
multiple-applications|identity, namespace, tab, conflict ও deterministic routing।
api-reference|Web app-এর BrowserMCP public API ও type।
bridge-configuration|loopback endpoint, Origin policy, limit ও log।
troubleshooting|connection, auth, version ও routing-এর evidence-first diagnosis।
development|workspace, site architecture, quality gate ও contribution boundary।
roadmap|implemented scope, planned work ও known constraint।`,
  `introduction/problem|BrowserMCP যে সমস্যা সমাধান করে|Web app-এ logic ও data থাকা সত্ত্বেও আলাদা MCP server তা নকল করে। BrowserMCP execution browser-এ রেখে generic local Bridge দিয়ে capability প্রকাশ করে, Bridge-এ app business logic যোগ করে না।
introduction/browser-runtime|Browser-ই MCP runtime|Handler page-এর JavaScript, Worker, WASM, IndexedDB, Canvas ও Web API ব্যবহার করে; Bridge কেবল authentication ও routing করে।
introduction/one-client-entry|একটি MCP client entry|Client একবার http://127.0.0.1:8789/mcp configure করে namespaced capability পায়। Loopback trust boundary নয়; প্রতিটি নতুন connection-এর exact Origin explicit operator approval চায়।
architecture/components|মূল উপাদান ও ঐচ্ছিক macOS shell|Client standard MCP ব্যবহার করে, Node.js Bridge আলাদা Bridge Protocol-এ রূপান্তর করে এবং Web library declarative handler চালায়; macOS app একই process supervise করে।
architecture/responsibility-boundaries|দায়িত্বের সীমা|Bridge session, auth, routing, limit, timeout ও conversion-এর মালিক; app declaration, semantic validation ও execution-এর; client intent ও approval-এর।
architecture/request-flow|Request flow|Bridge capability-কে একটি runtime-এ resolve করে request ID-সহ invoke পাঠায়; result, error, timeout, cancel ও disconnect correlated থাকে।
getting-started/prerequisites|পূর্বশর্ত|Node.js 24+, npm 11+, IPv4 loopback, বর্তমান browser ও Streamable HTTP client চাই; public HTTPS-এ trusted local certificate এবং native app-এ macOS 14+ ও Xcode লাগে।
getting-started/workspace-setup|Workspace install ও validate করুন|Root-এ npm install, তারপর typecheck, test, format:check ও build চালান; site external service ছাড়াই loopback-এ চলে।
getting-started/first-round-trip|প্রথম round trip সম্পন্ন করুন|Bridge চালু করে site থেকে access request পাঠান এবং authenticated Bridge management-এ exact Origin ও app identity approve করুন। MCP endpoint-এ Tools ও docs_search যাচাই করুন।
installing-macos-bridge/build|Cross-platform Bridge build ও run করুন|Canonical /bridge process macOS, Linux ও Windows-এ একই CLI, config, endpoint ও PEM ব্যবহার করে; OS service install বা trust পরিবর্তন করে না।
installing-macos-bridge/start|Native macOS app build ও ব্যবহার করুন|Unsigned menu-bar app একই Bridge, external Node, endpoint, explicit credential, pending exact-Origin approval-এর Approve/Reject, legacy token compatibility, status ও log পরিচালনা করে; secret memory-তে থাকে।
installing-macos-bridge/pair-site|Browser Origin approve করুন|Page থেকে request পাঠিয়ে Bridge management-এ exact scheme, host, port ও app identity যাচাই করুন, তারপর Approve বা Reject বেছে নিন। Approval-এর আগে session বা registration নেই; --pair-origin শুধু legacy compatibility।
configuring-mcp-client/client-entry|Common Bridge যোগ করুন|একটি browsermcp entry-তে Streamable HTTP loopback URL ও প্রতি startup-এর MCP bearer দিন; pairing ও admin token আলাদা।
configuring-mcp-client/verify|Initialization ও discovery যাচাই|Pairing-এর পরে session refresh করে namespaced Tools, Resources ও Prompts দেখুন; না থাকলে আগে Bridge list ও site panel দেখুন।
configuring-mcp-client/client-trust|Client-side approval|Discovery approval policy বদলায় না; descriptions/results-কে paired Origin-এর data ধরে user approval ও input limit বজায় রাখুন।
creating-app/minimal-app|App তৈরি ও connect করুন|@browsermcp/web install করে stable identity-সহ instance বানান, connect-এর আগে capability register করুন এবং পরের পরিবর্তন Bridge-এ sync করুন।
creating-app/static-hosting|Static hosting ব্যবহার|Library ESM ও bundler-এ app-specific backend ছাড়া চলে; remote Origin-এ HTTPS বাধ্যতামূলক, plain HTTP কেবল localhost।
creating-app/registration-lifecycle|Registration পরিচালনা|RegistrationHandle রাখুন, দরকারে ready await করুন, context শেষ হলে unregister করুন; disconnect runtime-এর সব capability সরায়।
tools/register-tool|Tool register করুন|app.tool-এ local name, description, closed JSON Schema ও async handler দিন; semantic rule validate ও side effect বর্ণনা করুন।
tools/tool-safety|নিরাপদ Tool design করুন|Input limit, AbortSignal ও idempotency মানুন; token, credential, cross-origin data বা arbitrary script প্রকাশ করবেন না।
tools/site-tools|এই site-এর Tool|Site Docs, context, runtime, Origin-scoped IndexedDB ও bounded Worker analysis দেয়; arbitrary navigation বা code execution দেয় না।
resources/register-resource|Resource register করুন|Stable URI-কে সঠিক MIME-সহ async read-এ map করুন; live state-এর প্রতিটি read নতুন snapshot এবং state বদলায় না।
resources/site-resources|Documentation Resource|browsermcp://docs ও browsermcp://site URI canonical typed English corpus থেকে page, status ও live snapshot দেয়।
resources/resource-errors|Resource error|Missing item structured not-found দেয়; runtime disconnect হলে stale read unavailable হয়, অন্য runtime-এ route হয় না।
prompts/register-prompt|Prompt register করুন|app.prompt argument validate করে browser-এ MCP message বানায়, value-কে data ধরে এবং permission bypass করে না।
prompts/site-prompts|Site-এর development Prompt|Prompt setup, implementation, diagnosis ও boundary review-কে structured Docs এবং page/section citation দিয়ে guide করে।
prompts/prompt-safety|Prompt safety|Argument untrusted ও output advisory; এটি side effect authorize করে না বা secret অন্তর্ভুক্ত করে না।
results-errors/success-results|সফল result|Tool MCP content ও optional structuredContent ফেরায়; Resource/Prompt standard shape রাখে এবং request ID response correlate করে।
results-errors/errors|Execution ও protocol error|Exception safe HANDLER_ERROR হয়, stack প্রকাশ পায় না; invalid envelope, version, auth, size ও ID handler-এর আগে reject হয়।
results-errors/timeout-cancel|Timeout ও cancellation|Deadline বা client cancel handler AbortSignal abort করে এবং late result উপেক্ষা করে; সম্পন্ন side effect rollback হয় না।
connection-lifecycle/state-machine|Connection state machine|connect WebSocket খোলে, version/features negotiate করে এবং awaiting-approval-এ যায়। Bridge admin exact Origin approve করার পরই session ও capabilities তৈরি হয়, এবং connected runtime invoke পায়।
connection-lifecycle/reconnect|নিরাপদ reconnect|Retryable loss bounded backoff ব্যবহার করে এবং session proof শুধু valid থাকলে পাঠায়। expired বা rejected credential মুছে যায়; নতুন session লাগলে user আবার approval request করে।
connection-lifecycle/disconnect|Disconnect ও cleanup|disconnect socket বন্ধ, work abort, session credential মুছে কেবল ওই runtime-এর capability atomically সরায়।
bridge-protocol/separation|Standard MCP থেকে পৃথক|MCP Bridge-এ শেষ হয়; internal protocol raw MCP tunnel না করে connect, register, invoke, result, cancel ও heartbeat model করে।
bridge-protocol/envelope|Envelope ও identifier|প্রতি message-এ version, kind, context ও bounded payload থাকে; request ID একটি terminal response-এর সাথে যুক্ত এবং v1 unknown field/kind reject করে।
bridge-protocol/handshake|Handshake ও negotiation|Common version ও features ঠিক হয়। v1.1 approval credential ছাড়া approval_required পায়; exact Origin explicit approval-এর পরই session/registration হয়। v1.0 token/resume compatibility path।
bridge-protocol/validation|Message validation|উভয় endpoint runtime JSON, limit ও state order validate করে; log credential redact করে এবং result body রাখে না।
security-model/trust-boundaries|Trust boundary|MCP client, local Bridge ও browser Origin আলাদা principal; loopback page authenticate করে না এবং declared ID কেবল routing metadata।
security-model/pairing|Origin-bound approval|browser credential ছাড়া request করে। Bridge authenticated admin page-এ short-lived request ও exact Origin দেখায়; Approve-এর আগে session/registration নেই, Reject বা expiry wait বন্ধ করে।
security-model/input-limits|Limit ও rejection|Size, concurrency, time ও shape bounded; unknown, unauthenticated বা malformed message fail closed হয়।
security-model/known-boundaries|Known security boundary|Capability নিজ Origin-এর privilege-এ চলে ও browser policy bypass করে না; v0.1 disconnect বা restart দিয়ে authority revoke করে।
multiple-applications/identity|Application ও runtime identity|Observed Origin principal; app/runtime/instance self-declared routing metadata, তাই mutually untrusted app আলাদা Origin ব্যবহার করবে।
multiple-applications/namespacing|Name ও collision|App namespace একই local name আলাদা রাখে; duplicate provider ambiguity তৈরি করে এবং last-writer-wins নিষিদ্ধ।
multiple-applications/runtime-selection|Runtime selection ও removal|v0.1 instance select করে না; এক provider রাখুন এবং disconnect-এ silent reroute ছাড়া শুধু ওই runtime সরান।
api-reference/browsermcp|BrowserMCP class|Class registration, state, request, log ও cleanup own করে; public API/event ব্যবহার করুন, internal message detail নয়।
api-reference/registration-types|Tool, Resource ও Prompt definition|Typed definition metadata, schema ও async handler যুক্ত করে; stable name/URI duplicate হলে reject হয়।
api-reference/connection-types|Connection ও diagnostics type|Options URL, identity, reconnect, timeout, approval wait, store ও LNA দেয়। ConnectOptions request policy ও optional legacy token দেয়; snapshot awaiting-approval ও non-secret request data দেখায়।
api-reference/protocol-types|Protocol type internal|@browsermcp/protocol implementer-এর জন্য; সাধারণ app @browsermcp/web ব্যবহার করে raw message পাঠায় না।
bridge-configuration/network|Network endpoint|MCP ও browser 127.0.0.1:8789 ভাগ করে; host fixed এবং port change client ও page দুটিতে দিতে হয়।
bridge-configuration/https-site|HTTPS site ও local WSS|127.0.0.1 SAN certificate ও wss/https ব্যবহার করুন; request পাঠিয়ে Bridge-এ exact Origin approve করুন। শুধু local CA trust করুন, credential-free health দিয়ে LNA নিন এবং HTTPS থেকে ws-এ নামাবেন না।
bridge-configuration/limits|Request limit|Payload, concurrency, deadline, idle ও ping finite; বাড়ালে risk বাড়ে এবং Tool schema replace হয় না।
bridge-configuration/secrets-logs|Approval ও log|Pending Origin request bounded ও expiring; শুধু legacy token on demand তৈরি হয়। Bounded log known field, Authorization ও URL secret redact করে এবং result body রাখে না।
troubleshooting/diagnostic-order|Diagnostic order|Health, endpoint, Origin, auth, negotiation, session, registration ও routing-এর পরে handler দেখুন; request ID দিয়ে correlate করুন, token নয়।
troubleshooting/bridge-not-connected|Bridge connected নয়|Listener absent, unpaired page, expired session ও failed registration-কে state ও safe error দিয়ে আলাদা করুন; AUTH_REQUIRED error code।
troubleshooting/origin-error|Origin rejected|Scheme, host ও port Bridge-এর pending request-এর সঙ্গে exact compare করুন, আবার request পাঠিয়ে শুধু exact Origin approve করুন; '*' বা validation disable ব্যবহার করবেন না।
troubleshooting/authentication-error|Authentication failed|APPROVAL_REJECTED মানে reject; APPROVAL_EXPIRED হলে tab খোলা রেখে আবার request করুন। Legacy AUTH_INVALID বা SESSION_RESUME_REJECTED-এ নতুন approval বা compatibility token নিন; credential log করবেন না।
troubleshooting/name-conflict|Capability name conflict|Candidate দেখুন ও duplicate tab বন্ধ করুন; v0.1 instance select করে না এবং ambiguity reject করে।
troubleshooting/version-mismatch|Protocol version mismatch|Version compare, একই checkout build ও পুরোনো component update করুন; compatibility force করবেন না।
development/workspace|Workspace layout|Protocol, web, Bridge, macOS shell, site, test ও docs-কে Node 24+, ESM, strict TypeScript ও OS-neutral path-সহ আলাদা রাখুন।
development/site-architecture|Site architecture|UI ও MCP typed canonical English corpus ও structured index ব্যবহার করে; i18n stable ID, route বা controller না বদলে translation overlay দেয়।
development/github-pages-build|GitHub Pages subpath build|.github/workflows/pages.yml main-এ npm run check চালায়, Pages base_path দিয়ে rebuild করে এবং শুধু site/dist deploy করে। HTTPS site-এর জন্য এখনও local CA/WSS, credential-free health, LNA ও Bridge-এ exact Origin approval দরকার।
development/quality-gates|Quality gate|Format, typecheck, unit, integration ও build বাধ্যতামূলক; manual check-এ environment, step, expected result ও limit লিখুন।
development/contributing|Contribution rule|Generic logic protocol/Bridge ও app logic browser-এ রাখুন; Docs/test sync করুন এবং secret বা deploy output publish করবেন না।
roadmap/implemented|এই repository-তে implemented|Typed protocol, Web library, portable Bridge, macOS app, Vite site, Docs MCP ও section status-সহ test আছে।
roadmap/verification-status|বাস্তব environment verification|GitHub Pages run 29643866925 সব quality gate পেরিয়ে https://masashi-desu.github.io/BrowserMCP/ deploy করেছে। বিচ্ছিন্ন Chrome context-এ LNA permission, loopback TLS Bridge, exact Origin approval, 19/23/4 registration এবং official MCP SDK থেকে docs_get_section call সফল হয়েছে। Context loopback TLS error উপেক্ষা করেছিল, তাই OS-এ manual CA trust, interactive permission UI, Safari, Edge এবং Firefox এখনো verify করা হয়নি।
roadmap/distribution|Distribution ও অন্য platform|Docs site main থেকে GitHub Pages-এ deploy হয়; npm, Releases, App Store, signing ও notarization scope-এর বাইরে। অন্য platform-এর future validation দরকার।
roadmap/security-hardening|Future security hardening|Loopback, pairing, validation, limit ও redaction চালু; external review, release storage ও finer consent/audit ভবিষ্যৎ কাজ।
roadmap/known-constraints|Known constraint|শুধু Apple Silicon macOS verified; native app external Node চায় ও browser rule প্রযোজ্য, cloud relay বা remote browser নেই।`,
);

const catalogs: Partial<Record<SupportedLocale, LocaleCatalog>> = {
  ja,
  "zh-CN": zhCN,
  es,
  hi,
  ar,
  "pt-BR": ptBR,
  bn,
  ru,
};

export const localizedDocPage = (
  locale: SupportedLocale,
  page: DocPage,
  localizedTitle: string,
): LocalizedDocPage => {
  const selected = catalogs[locale];
  return {
    title: localizedTitle,
    description: selected?.pageDescriptions[page.id] ?? page.description,
    sections: Object.fromEntries(
      page.sections.map((section) => {
        const translation = selected?.sections[`${page.id}/${section.id}`];
        return [
          section.id,
          translation ?? { title: section.title, body: section.content.join("\n\n") },
        ];
      }),
    ),
  };
};

export const localizedDocSection = (
  locale: SupportedLocale,
  page: DocPage,
  section: DocSection,
): LocalizedDocSection =>
  catalogs[locale]?.sections[`${page.id}/${section.id}`] ?? {
    title: section.title,
    body: section.content.join("\n\n"),
  };

export const missingLocalizedDocKeys = (
  locale: Exclude<SupportedLocale, "en">,
  pages: readonly DocPage[],
): readonly string[] => {
  const selected = catalogs[locale];
  if (selected === undefined) return [`catalog:${locale}`];
  return pages.flatMap((page) => [
    ...(selected.pageDescriptions[page.id]?.length ? [] : [`page:${page.id}`]),
    ...page.sections.flatMap((section) => {
      const value = selected.sections[`${page.id}/${section.id}`];
      return value?.title.length && value.body.length ? [] : [`section:${page.id}/${section.id}`];
    }),
  ]);
};

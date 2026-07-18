export const BRIDGE_PORT = 8789;
export const DEVELOPMENT_BRIDGE_URL = `ws://127.0.0.1:${BRIDGE_PORT}/browser`;
export const SECURE_BRIDGE_URL = `wss://127.0.0.1:${BRIDGE_PORT}/browser`;

export type DiagnosticLevel = "ready" | "check" | "blocked";

export interface ConnectionDiagnostic {
  readonly id: "transport" | "certificate" | "origin" | "local-network";
  readonly title: string;
  readonly level: DiagnosticLevel;
  readonly detail: string;
  readonly action?: string;
}

const isLocalPage = (pageUrl: Pick<URL, "hostname">): boolean =>
  pageUrl.hostname === "localhost" || pageUrl.hostname === "127.0.0.1";

export const defaultBridgeUrl = (pageUrl: Pick<URL, "protocol" | "hostname">): string => {
  if (pageUrl.protocol === "https:") return SECURE_BRIDGE_URL;
  if (pageUrl.protocol === "http:" && isLocalPage(pageUrl)) return DEVELOPMENT_BRIDGE_URL;
  throw new Error("A non-loopback BrowserMCP site must be served over HTTPS.");
};

export const validateBridgeUrl = (
  value: string,
  pageUrl?: Pick<URL, "protocol" | "hostname">,
): URL => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Bridge URL must be an absolute ws:// or wss:// URL.");
  }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("Bridge URL must use ws:// or wss://.");
  }
  if (!(url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
    throw new Error(
      "Bridge URL must use the localhost or 127.0.0.1 loopback host; the Bridge is IPv4-only.",
    );
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error("Credentials must not be embedded in the Bridge URL.");
  }
  if (url.pathname !== "/browser") {
    throw new Error("Bridge WebSocket path must be /browser.");
  }
  if (url.search !== "" || url.hash !== "") {
    throw new Error("Bridge URL must not contain query parameters or a fragment.");
  }
  if (pageUrl?.protocol === "https:" && url.protocol !== "wss:") {
    throw new Error("An HTTPS page must use a trusted wss:// Bridge URL.");
  }
  if (pageUrl?.protocol === "http:" && !isLocalPage(pageUrl)) {
    throw new Error("A non-loopback BrowserMCP site must be served over HTTPS.");
  }
  return url;
};

export const connectionDiagnostics = (
  bridgeUrl: string,
  pageUrl: Pick<URL, "protocol" | "origin" | "hostname">,
): readonly ConnectionDiagnostic[] => {
  let bridge: URL;
  try {
    bridge = validateBridgeUrl(bridgeUrl, pageUrl);
  } catch (error) {
    return [
      {
        id: "transport",
        title: "Loopback transport",
        level: "blocked",
        detail: error instanceof Error ? error.message : "Invalid Bridge URL.",
      },
    ];
  }
  const mixedContent = pageUrl.protocol === "https:" && bridge.protocol !== "wss:";
  return [
    {
      id: "transport",
      title: "Loopback transport",
      level: mixedContent ? "blocked" : "ready",
      detail: mixedContent
        ? "An HTTPS page cannot safely open an insecure ws:// Bridge."
        : `${bridge.protocol}//${bridge.host} is a loopback-only endpoint.`,
      ...(mixedContent ? { action: "Use wss://127.0.0.1:8789/browser." } : {}),
    },
    {
      id: "certificate",
      title: "Trusted local certificate",
      level: bridge.protocol === "wss:" ? "check" : "ready",
      detail:
        bridge.protocol === "wss:"
          ? "The browser must trust the Bridge's localhost certificate before WebSocket setup."
          : "Local HTTP development does not use TLS; published HTTPS pages must use WSS.",
      ...(bridge.protocol === "wss:"
        ? {
            action: `Install and explicitly trust the generated local CA, then open https://${bridge.host}/health. Do not bypass a certificate warning.`,
          }
        : {}),
    },
    {
      id: "origin",
      title: "Exact Origin approval",
      level: "check",
      detail: `Approve exactly ${pageUrl.origin}; scheme, host, and port are significant.`,
      action:
        "Request access from the page, then approve this exact Origin in the authenticated Bridge management page.",
    },
    {
      id: "local-network",
      title: "Local network permission",
      level: "check",
      detail:
        "Chrome 142 gates fetch-like loopback requests; Chrome 147 extends LNA permission to WebSockets.",
      action:
        "Allow loopback access when prompted and ensure the Bridge health response permits this Origin.",
    },
  ];
};

export const bridgeHealthUrl = (bridgeUrl: string): string => {
  const url = validateBridgeUrl(bridgeUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = "/health";
  url.search = "";
  url.hash = "";
  return url.toString();
};

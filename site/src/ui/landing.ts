import type { Translator } from "../i18n/index.js";
import { codeBlock, element, link } from "./dom.js";
import { routeHref } from "./router.js";

const feature = (index: string, title: string, text: string): HTMLElement =>
  element("article", { className: "feature-card" }, [
    element("span", { className: "feature-card__index" }, [index]),
    element("h3", {}, [title]),
    element("p", {}, [text]),
  ]);

export const renderLanding = (connectionState: string, translator: Translator): HTMLElement => {
  const main = element("main", { id: "main-content", className: "landing" });
  const hero = element("section", { className: "hero" }, [
    element("h1", {}, [
      translator.t("landing.heroBefore"),
      element("span", { className: "text-gradient" }, [translator.t("landing.heroHighlight")]),
    ]),
    element("p", { className: "hero__lede" }, [translator.t("landing.lede")]),
    element("div", { className: "hero__actions" }, [
      link(translator.t("landing.readDocs"), routeHref("/docs"), "button button--primary"),
      link(
        connectionState === "connected"
          ? translator.t("common.bridgeConnected")
          : translator.t("landing.connectBridge"),
        routeHref("/connection"),
        "button button--secondary",
      ),
    ]),
    element("div", { className: "hero__proof" }, [
      element("span", {}, [translator.t("landing.proofEndpoint")]),
      element("span", {}, [translator.t("landing.proofOrigin")]),
      element("span", {}, [translator.t("landing.proofBrowser")]),
    ]),
  ]);

  const architecture = element("section", { className: "section section--architecture" }, [
    element("div", { className: "section-heading" }, [
      element("p", { className: "kicker" }, [translator.t("common.architecture")]),
      element("h2", {}, [translator.t("landing.architectureTitle")]),
      element("p", {}, [translator.t("landing.architectureText")]),
    ]),
    element("div", { className: "flow" }, [
      element("div", { className: "flow__node" }, [
        element("span", { className: "flow__label" }, [translator.t("landing.standardMcp")]),
        element("strong", {}, [translator.t("landing.mcpClient")]),
        element("small", {}, [translator.t("landing.streamableHttp")]),
      ]),
      element("div", { className: "flow__connector" }, ["→"]),
      element("div", { className: "flow__node flow__node--bridge" }, [
        element("span", { className: "flow__label" }, [translator.t("landing.localRouter")]),
        element("strong", {}, [translator.t("landing.localBridge")]),
        element("small", {}, ["127.0.0.1 · auth · limits"]),
      ]),
      element("div", { className: "flow__connector" }, ["→"]),
      element("div", { className: "flow__node flow__node--browser" }, [
        element("span", { className: "flow__label" }, [translator.t("landing.execution")]),
        element("strong", {}, [translator.t("landing.browserApp")]),
        element("small", {}, ["Tools · Resources · Prompts"]),
      ]),
    ]),
  ]);

  const capabilities = element("section", { className: "section" }, [
    element("div", { className: "section-heading section-heading--split" }, [
      element("div", {}, [
        element("p", { className: "kicker" }, [translator.t("landing.why")]),
        element("h2", {}, [translator.t("landing.contextTitle")]),
      ]),
      element("p", {}, [translator.t("landing.contextText")]),
    ]),
    element("div", { className: "feature-grid" }, [
      feature(
        "01",
        translator.t("landing.featureBackendTitle"),
        translator.t("landing.featureBackendText"),
      ),
      feature(
        "02",
        translator.t("landing.featureBridgeTitle"),
        translator.t("landing.featureBridgeText"),
      ),
      feature(
        "03",
        translator.t("landing.featureTypedTitle"),
        translator.t("landing.featureTypedText"),
      ),
      feature(
        "04",
        translator.t("landing.featureStaticTitle"),
        translator.t("landing.featureStaticText"),
      ),
      feature(
        "05",
        translator.t("landing.featureManyTitle"),
        translator.t("landing.featureManyText"),
      ),
      feature(
        "06",
        translator.t("landing.featureSecurityTitle"),
        translator.t("landing.featureSecurityText"),
      ),
    ]),
  ]);

  const quickstart = element("section", { className: "section quickstart" }, [
    element("div", { className: "section-heading" }, [
      element("p", { className: "kicker" }, [translator.t("landing.minimal")]),
      element("h2", {}, [translator.t("landing.declareTitle")]),
      element("p", {}, [translator.t("landing.declareText")]),
    ]),
    codeBlock(
      `import { BrowserMCP } from "@browsermcp/web";\n\nconst securePage = location.protocol === "https:";\nconst app = new BrowserMCP({\n  name: "Example App",\n  version: "0.1.0",\n  bridgeUrl: securePage\n    ? "wss://127.0.0.1:8789/browser"\n    : "ws://127.0.0.1:8789/browser",\n  prepareLocalNetworkAccess: securePage,\n});\n\napp.tool({\n  name: "current_page",\n  inputSchema: { type: "object", additionalProperties: false },\n  handler: async () => ({\n    content: [{ type: "text", text: location.origin + location.pathname }],\n    structuredContent: { origin: location.origin, pathname: location.pathname },\n  }),\n});\n\nawait app.connect();`,
      "typescript",
      translator.t("common.codeExample", { language: "TypeScript" }),
    ),
    element("p", { className: "quickstart__note" }, [translator.t("landing.pairingNote")]),
  ]);

  const docsCta = element("section", { className: "section cta" }, [
    element("div", {}, [
      element("p", { className: "kicker" }, [translator.t("landing.sourceDocs")]),
      element("h2", {}, [translator.t("landing.docsTitle")]),
      element("p", {}, [translator.t("landing.docsText")]),
    ]),
    link(
      translator.t("landing.exploreDocs", { count: translator.number(19) }),
      routeHref("/docs"),
      "button button--primary",
    ),
  ]);

  main.append(hero, architecture, capabilities, quickstart, docsCta);
  return main;
};

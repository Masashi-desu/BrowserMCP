import "./styles.css";
import { BrowserMcpSiteController } from "./browsermcp/controller.js";
import { defaultBridgeUrl, validateBridgeUrl } from "./runtime/bridge-config.js";
import {
  applyDocumentLocale,
  createTranslator,
  loadLocale,
  saveLocale,
  type SupportedLocale,
} from "./i18n/index.js";
import { renderApp } from "./ui/app.js";
import { createConnectionDraft } from "./ui/connection.js";
import { parseRoute, type Route, routeSnapshot } from "./ui/router.js";

const root = document.querySelector<HTMLElement>("#app");
if (root === null) throw new Error("Missing #app root element.");

if (location.hash === "")
  history.replaceState(null, "", `${location.pathname}${location.search}#/`);

let route: Route = parseRoute(location.hash);
const localeStorage = (() => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
})();
let locale = loadLocale(localeStorage, navigator.languages);
let translator = createTranslator(locale);
applyDocumentLocale(translator);
const configuredBridgeUrl = import.meta.env.VITE_BRIDGE_URL?.trim();
let initialBridgeUrl = defaultBridgeUrl(new URL(location.href));
if (configuredBridgeUrl !== undefined && configuredBridgeUrl !== "") {
  try {
    initialBridgeUrl = validateBridgeUrl(configuredBridgeUrl, new URL(location.href)).toString();
  } catch {
    // Keep the safe protocol-aware default; the editable connection UI can diagnose custom values.
  }
}

const controller = new BrowserMcpSiteController(initialBridgeUrl, () =>
  routeSnapshot(route, translator),
);
const connectionDraft = createConnectionDraft(initialBridgeUrl);
let model = controller.getViewModel();

const render = (routeChanged = false): void => {
  renderApp(root, route, model, controller, connectionDraft, translator, setLocale);
  if (routeChanged && route.kind === "docs-page" && route.sectionId !== undefined) {
    const sectionId = route.sectionId;
    requestAnimationFrame(() => document.getElementById(sectionId)?.scrollIntoView());
  } else if (routeChanged) {
    scrollTo({ top: 0, behavior: "instant" });
  }
};

function setLocale(nextLocale: SupportedLocale): void {
  if (nextLocale === locale) return;
  locale = nextLocale;
  translator = createTranslator(locale);
  saveLocale(locale, localeStorage);
  applyDocumentLocale(translator);
  render(false);
}

let initialRender = true;
controller.subscribe((nextModel) => {
  const previousConnectionState = model.connectionState;
  model = nextModel;
  // Registration churn, handler logs, and heartbeat pongs update the status view,
  // but must not destroy Docs search state or reset article scroll position.
  if (
    initialRender ||
    route.kind === "connection" ||
    nextModel.connectionState !== previousConnectionState
  ) {
    render(initialRender);
  }
  initialRender = false;
});

window.addEventListener("hashchange", () => {
  route = parseRoute(location.hash);
  render(true);
});

document.querySelector<HTMLAnchorElement>(".skip-link")?.addEventListener("click", (event) => {
  event.preventDefault();
  const main = document.querySelector<HTMLElement>("#main-content");
  if (main === null) return;
  main.tabIndex = -1;
  main.focus();
});

window.addEventListener("beforeunload", () => {
  void controller.destroy();
});

import type {
  ConnectionViewModel,
  SiteConnectionController,
} from "../browsermcp/controller-types.js";
import {
  localeDefinitions,
  isSupportedLocale,
  type SupportedLocale,
  type Translator,
} from "../i18n/index.js";
import { type ConnectionDraft, renderConnection } from "./connection.js";
import { renderDocPage, renderDocsIndex } from "./docs.js";
import { element, link } from "./dom.js";
import { renderLanding } from "./landing.js";
import { type Route, routeHref } from "./router.js";

const localizedState = (translator: Translator, state: string): string => {
  const keys = {
    connected: "common.connected",
    connecting: "common.connecting",
    "awaiting-approval": "common.awaitingApproval",
    reconnecting: "common.reconnecting",
    disconnected: "common.disconnected",
    error: "common.error",
  } as const;
  return translator.t(keys[state as keyof typeof keys] ?? "common.disconnected");
};

const languageSelector = (
  translator: Translator,
  onLocaleChange: (locale: SupportedLocale) => void,
): HTMLElement => {
  const select = element("select", {
    className: "language-select",
    ariaLabel: translator.t("common.languageSelect"),
  });
  for (const definition of localeDefinitions) {
    const option = element("option", {}, [definition.nativeName]);
    option.value = definition.locale;
    option.selected = definition.locale === translator.locale;
    option.lang = definition.locale;
    option.dir = definition.direction;
    select.append(option);
  }
  select.addEventListener("change", () => {
    if (isSupportedLocale(select.value)) onLocaleChange(select.value);
  });
  return element("label", { className: "language-picker" }, [
    element("span", { className: "visually-hidden" }, [translator.t("common.language")]),
    select,
  ]);
};

const header = (
  route: Route,
  model: ConnectionViewModel,
  translator: Translator,
  onLocaleChange: (locale: SupportedLocale) => void,
): HTMLElement => {
  const brand = link("BrowserMCP", routeHref("/"), "brand");
  brand.prepend(element("span", { className: "brand__mark" }, ["B"]));
  const navigation = element(
    "nav",
    { className: "site-nav", ariaLabel: translator.t("common.primaryNavigation") },
    [
      link(
        translator.t("common.overview"),
        routeHref("/"),
        route.kind === "landing" ? "is-active" : undefined,
      ),
      link(
        translator.t("common.docs"),
        routeHref("/docs"),
        route.kind.startsWith("docs") ? "is-active" : undefined,
      ),
      link(
        translator.t("common.connection"),
        routeHref("/connection"),
        route.kind === "connection" ? "is-active" : undefined,
      ),
    ],
  );
  const status = link(
    model.connectionState === "connected"
      ? translator.t("common.bridgeConnected")
      : localizedState(translator, model.connectionState),
    routeHref("/connection"),
    `header-status header-status--${model.connectionState}`,
  );
  status.prepend(element("span", { className: "signal-dot" }));
  return element("header", { className: "site-header" }, [
    element("div", { className: "site-header__inner" }, [
      brand,
      navigation,
      element("div", { className: "site-header__actions" }, [
        languageSelector(translator, onLocaleChange),
        status,
      ]),
    ]),
  ]);
};

const footer = (translator: Translator): HTMLElement =>
  element("footer", { className: "site-footer" }, [
    element("strong", {}, ["BrowserMCP"]),
    element("span", {}, [translator.t("common.tagline")]),
  ]);

const notFound = (path: string, translator: Translator): HTMLElement =>
  element("main", { id: "main-content", className: "not-found" }, [
    element("p", { className: "kicker" }, [translator.t("notFound.kicker")]),
    element("h1", {}, [translator.t("notFound.title")]),
    element("p", {}, [translator.t("notFound.path", { path })]),
    link(translator.t("notFound.return"), routeHref("/docs"), "button button--primary"),
  ]);

export const renderApp = (
  root: HTMLElement,
  route: Route,
  model: ConnectionViewModel,
  controller: SiteConnectionController,
  connectionDraft: ConnectionDraft,
  translator: Translator,
  onLocaleChange: (locale: SupportedLocale) => void,
): void => {
  const page =
    route.kind === "landing"
      ? renderLanding(model.connectionState, translator)
      : route.kind === "docs-index"
        ? renderDocsIndex(translator)
        : route.kind === "docs-page"
          ? renderDocPage(route.pageId, translator)
          : route.kind === "connection"
            ? renderConnection(model, controller, connectionDraft, translator)
            : notFound(route.path, translator);
  root.replaceChildren(header(route, model, translator, onLocaleChange), page, footer(translator));
  document.title = `${route.kind === "landing" ? "BrowserMCP" : (page.querySelector("h1")?.textContent ?? "BrowserMCP")} — BrowserMCP`;
};

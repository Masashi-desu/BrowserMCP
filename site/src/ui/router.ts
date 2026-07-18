import type { SitePageSnapshot } from "../browsermcp/capabilities.js";
import { docsById } from "../docs/content.js";
import { localizedDocPageTitle } from "../i18n/docs.js";
import { createTranslator, type Translator } from "../i18n/index.js";

export type Route =
  | { readonly kind: "landing"; readonly path: "/" }
  | { readonly kind: "docs-index"; readonly path: "/docs" }
  | {
      readonly kind: "docs-page";
      readonly path: string;
      readonly pageId: string;
      readonly sectionId?: string;
    }
  | { readonly kind: "connection"; readonly path: "/connection" }
  | { readonly kind: "not-found"; readonly path: "/not-found" };

const normalizePath = (raw: string): string => {
  const withoutHash = raw.replace(/^#?\/?/u, "/");
  const [path = "/"] = withoutHash.split("?");
  return path.length > 1 ? path.replace(/\/$/u, "") : path;
};

export const parseRoute = (hash: string): Route => {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const [pathPart = "/", sectionId] = raw.split("#");
  const path = normalizePath(pathPart);
  if (path === "/") return { kind: "landing", path: "/" };
  if (path === "/docs") return { kind: "docs-index", path: "/docs" };
  if (path === "/connection") return { kind: "connection", path: "/connection" };
  const match = /^\/docs\/([a-z0-9-]+)$/u.exec(path);
  if (match?.[1] !== undefined && docsById.has(match[1])) {
    const page = docsById.get(match[1]);
    const knownSection = page?.sections.some(({ id }) => id === sectionId) === true;
    return {
      kind: "docs-page",
      path,
      pageId: match[1],
      ...(knownSection && sectionId !== undefined ? { sectionId } : {}),
    };
  }
  return { kind: "not-found", path: "/not-found" };
};

export const routeHref = (path: string, sectionId?: string): string =>
  `#${path}${sectionId === undefined ? "" : `#${sectionId}`}`;

export const routeSnapshot = (
  route: Route,
  translator: Translator = createTranslator("en"),
): SitePageSnapshot => {
  if (route.kind === "docs-page") {
    const page = docsById.get(route.pageId);
    return {
      title:
        page === undefined
          ? translator.t("docs.documentation")
          : localizedDocPageTitle(translator.locale, page.id, page.title),
      path: route.path,
      route: route.kind,
      docPageId: route.pageId,
      hash: route.sectionId ?? "",
      locale: translator.locale,
      direction: translator.direction,
    };
  }
  const titles: Record<Exclude<Route["kind"], "docs-page">, string> = {
    landing: "BrowserMCP",
    "docs-index": translator.t("docs.documentation"),
    connection: translator.t("connection.title"),
    "not-found": translator.t("notFound.kicker"),
  };
  return {
    title: titles[route.kind],
    path: route.path,
    route: route.kind,
    hash: "",
    locale: translator.locale,
    direction: translator.direction,
  };
};

import { docs, docsById } from "../docs/content.js";
import { docsStatus, searchDocs } from "../docs/engine.js";
import type { DocPage, ImplementationStatus, SearchResult } from "../docs/schema.js";
import { localizedDocPageTitle, localizedDocSectionTitle } from "../i18n/docs.js";
import { localizedDocPage, localizedDocSection } from "../i18n/docs-content.js";
import type { MessageKey, Translator } from "../i18n/index.js";
import { badge, codeBlock, element, link } from "./dom.js";
import { routeHref } from "./router.js";

const statusKeys: Record<ImplementationStatus, MessageKey> = {
  implemented: "common.implemented",
  partial: "common.partial",
  planned: "common.planned",
  constraint: "common.constraint",
};

const meaningfulStatusBadge = (
  status: ImplementationStatus,
  translator: Translator,
): HTMLElement | false =>
  status === "implemented" ? false : badge(translator.t(statusKeys[status]), status);

const docsSidebar = (translator: Translator, activeId?: string): HTMLElement =>
  element("aside", { className: "docs-sidebar", ariaLabel: translator.t("docs.navigation") }, [
    element("div", { className: "docs-sidebar__header" }, [
      element("span", { className: "kicker" }, [translator.t("docs.documentation")]),
      element("strong", {}, [
        translator.t("docs.areas", { count: translator.number(docs.length) }),
      ]),
    ]),
    element(
      "nav",
      {},
      docs.map((page) => {
        const anchor = link(
          localizedDocPageTitle(translator.locale, page.id, page.title),
          routeHref(page.path),
          page.id === activeId ? "is-active" : undefined,
        );
        anchor.setAttribute("aria-current", page.id === activeId ? "page" : "false");
        return anchor;
      }),
    ),
  ]);

const searchResultNode = (result: SearchResult, translator: Translator): HTMLElement => {
  const page = docsById.get(result.pageId);
  const sourceSection = page?.sections.find((section) => section.id === result.sectionId);
  const translation =
    page === undefined || sourceSection === undefined
      ? undefined
      : localizedDocSection(translator.locale, page, sourceSection);
  return element("article", { className: "search-result" }, [
    element("div", { className: "search-result__meta" }, [
      meaningfulStatusBadge(result.status, translator),
      element("span", {}, [result.kind]),
      element("span", {}, [result.source]),
    ]),
    link(
      translation?.title ??
        localizedDocSectionTitle(
          translator.locale,
          result.pageId,
          result.sectionId,
          result.heading,
        ),
      routeHref(`/docs/${result.pageId}`, result.sectionId),
      "search-result__title",
    ),
    element("p", {}, [translation?.body ?? result.excerpt]),
    element("div", { className: "search-result__path" }, [
      `${localizedDocPageTitle(translator.locale, result.pageId, result.pageTitle)} · ${result.pageId}/${result.sectionId}`,
    ]),
  ]);
};

export const renderDocsIndex = (translator: Translator): HTMLElement => {
  const content = element("main", { id: "main-content", className: "docs-main docs-index" });
  content.append(
    element("div", { className: "docs-hero" }, [
      element("p", { className: "kicker" }, [translator.t("docs.kicker")]),
      element("h1", {}, [translator.t("docs.title")]),
      element("p", {}, [translator.t("docs.lede")]),
      element("div", { className: "docs-stats" }, [
        element("span", {}, [
          translator.t("docs.pages", { count: translator.number(docsStatus.pages) }),
        ]),
        element("span", {}, [
          translator.t("docs.sections", { count: translator.number(docsStatus.sections) }),
        ]),
        element("span", {}, [
          translator.t("docs.implemented", { count: translator.number(docsStatus.implemented) }),
        ]),
        element("span", {}, [
          translator.t("docs.planned", { count: translator.number(docsStatus.planned) }),
        ]),
        element("span", {}, [
          translator.t("docs.constraints", { count: translator.number(docsStatus.constraints) }),
        ]),
      ]),
    ]),
  );

  const results = element("div", { className: "search-results", id: "docs-search-results" });
  const search = element("input", {
    className: "docs-search",
    ariaLabel: translator.t("docs.searchLabel"),
  });
  search.type = "search";
  search.placeholder = translator.t("docs.searchPlaceholder");
  const renderResults = (): void => {
    const query = search.value.trim();
    results.replaceChildren();
    if (query.length === 0) {
      results.append(element("p", { className: "search-hint" }, [translator.t("docs.searchHint")]));
      return;
    }
    const matches = searchDocs(query, { limit: 10 });
    results.append(
      ...(matches.length > 0
        ? matches.map((result) => searchResultNode(result, translator))
        : [element("p", { className: "empty-state" }, [translator.t("docs.noResults")])]),
    );
  };
  search.addEventListener("input", renderResults);
  renderResults();
  content.append(
    element("section", { className: "docs-search-panel" }, [
      element("div", { className: "docs-search-command" }, [
        element("span", { ariaLabel: translator.t("docs.searchLabel") }, ["/"]),
        search,
      ]),
      results,
    ]),
  );

  content.append(
    element(
      "section",
      { className: "docs-card-grid", ariaLabel: translator.t("docs.areasLabel") },
      docs.map((page) => {
        const localized = localizedDocPage(
          translator.locale,
          page,
          localizedDocPageTitle(translator.locale, page.id, page.title),
        );
        return element("article", { className: "docs-card" }, [
          element("div", { className: "docs-card__meta" }, [
            element("span", {}, [String(page.order).padStart(2, "0")]),
            meaningfulStatusBadge(page.status, translator),
          ]),
          link(
            localizedDocPageTitle(translator.locale, page.id, page.title),
            routeHref(page.path),
            "docs-card__title",
          ),
          element("p", {}, [localized.description]),
          element("span", { className: "docs-card__count" }, [
            translator.t("docs.sectionCount", {
              count: translator.number(page.sections.length),
            }),
          ]),
        ]);
      }),
    ),
  );

  return element("div", { className: "docs-layout" }, [docsSidebar(translator), content]);
};

const sectionNode = (
  page: DocPage,
  section: DocPage["sections"][number],
  translator: Translator,
): HTMLElement => {
  const localized = localizedDocSection(translator.locale, page, section);
  const paragraphs =
    translator.locale === "en" ? [section.summary, ...section.content] : [localized.body];
  const node = element("section", { className: "doc-section", id: section.id }, [
    element("div", { className: "doc-section__heading" }, [
      element("div", {}, [
        element("span", { className: "doc-section__kind" }, [section.kind]),
        element("h2", {}, [
          link(localized.title, routeHref(page.path, section.id), "heading-anchor"),
        ]),
      ]),
      meaningfulStatusBadge(section.status, translator),
    ]),
    ...paragraphs.map((paragraph, index) =>
      element("p", index === 0 ? { className: "doc-section__summary" } : {}, [paragraph]),
    ),
  ]);
  for (const example of section.examples ?? []) {
    node.append(
      element("div", { className: "example" }, [
        element("div", { className: "example__header" }, [
          element("strong", {}, [
            translator.locale === "en"
              ? example.title
              : `${localized.title} · ${translator.t("common.codeExample", { language: example.language })}`,
          ]),
        ]),
        codeBlock(
          example.code,
          example.language,
          translator.t("common.codeExample", { language: example.language }),
        ),
        translator.locale === "en" ? element("p", {}, [example.explanation]) : false,
      ]),
    );
  }
  node.append(
    element("footer", { className: "doc-section__footer" }, [
      element("span", {}, [
        translator.t("common.source", { source: section.source ?? page.source }),
      ]),
      ...(section.related ?? []).map((reference) => {
        const [pageId, sectionId] = reference.split("/");
        return pageId === undefined
          ? false
          : link(
              translator.t("common.related", { reference }),
              routeHref(`/docs/${pageId}`, sectionId),
              "text-link",
            );
      }),
    ]),
  );
  return node;
};

export const renderDocPage = (pageId: string, translator: Translator): HTMLElement => {
  const page = docsById.get(pageId);
  if (page === undefined) return renderDocsIndex(translator);
  const previous = docs[page.order - 2];
  const next = docs[page.order];
  const localized = localizedDocPage(
    translator.locale,
    page,
    localizedDocPageTitle(translator.locale, page.id, page.title),
  );
  const article = element("main", { id: "main-content", className: "docs-main doc-page" }, [
    element("header", { className: "doc-page__header" }, [
      element("div", { className: "breadcrumbs" }, [
        link(translator.t("common.docs"), routeHref("/docs")),
        element("span", {}, ["/"]),
        element("span", {}, [localizedDocPageTitle(translator.locale, page.id, page.title)]),
      ]),
      element("div", { className: "doc-page__title-row" }, [
        element("div", {}, [
          element("p", { className: "kicker" }, [
            `${String(page.order).padStart(2, "0")} · ${page.audience.join(" · ")}`,
          ]),
          element("h1", {}, [localizedDocPageTitle(translator.locale, page.id, page.title)]),
          element("p", {}, [localized.description]),
        ]),
        meaningfulStatusBadge(page.status, translator),
      ]),
      element(
        "nav",
        { className: "on-this-page", ariaLabel: translator.t("docs.onThisPageLabel") },
        [
          element("strong", {}, [translator.t("docs.onThisPage")]),
          ...page.sections.map((section) =>
            link(
              localized.sections[section.id]?.title ?? section.title,
              routeHref(page.path, section.id),
            ),
          ),
        ],
      ),
    ]),
    ...page.sections.map((section) => sectionNode(page, section, translator)),
    element("nav", { className: "doc-pagination", ariaLabel: translator.t("docs.adjacent") }, [
      previous === undefined
        ? element("span")
        : link(
            `← ${localizedDocPageTitle(translator.locale, previous.id, previous.title)}`,
            routeHref(previous.path),
            "doc-pagination__link",
          ),
      next === undefined
        ? link(translator.t("docs.backToIndex"), routeHref("/docs"), "doc-pagination__link")
        : link(
            `${localizedDocPageTitle(translator.locale, next.id, next.title)} →`,
            routeHref(next.path),
            "doc-pagination__link",
          ),
    ]),
  ]);
  return element("div", { className: "docs-layout" }, [docsSidebar(translator, page.id), article]);
};

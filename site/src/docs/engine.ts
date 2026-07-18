import { DOCS_VERSION, docs, docsById } from "./content.js";
import type {
  CapabilitySummary,
  DocPage,
  DocsAnswer,
  DocsError,
  DocsResult,
  ImplementationGuide,
  NavigableDocPage,
  NavigableDocSection,
  RelatedDocument,
  SearchOptions,
  SearchResult,
  TroubleshootingReport,
} from "./schema.js";

const SOURCE = {
  corpus: "browsermcp-site-docs",
  version: DOCS_VERSION,
  generatedFrom: "structured-docs",
} as const;

const SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  setup: ["install", "getting started", "first run", "prerequisites"],
  initial: ["getting started", "first round trip", "setup"],
  configure: ["configuration", "MCP client", "client entry"],
  register: ["registration", "app.tool", "app.resource", "app.prompt"],
  tool: ["tools", "app.tool", "handler", "inputSchema"],
  type: ["types", "interface", "definition", "ConnectionOptions"],
  api: ["API", "class", "method", "definition"],
  disconnected: ["not connected", "reconnect", "listener", "session"],
  connection: ["connect", "disconnect", "reconnect", "session", "pairing"],
  origin: ["Origin error", "origin rejected", "exact Origin", "scheme host port"],
  authentication: ["authentication error", "invalid token", "expired", "pairing"],
  auth: ["authentication", "token", "pairing"],
  collision: ["name conflict", "ambiguous", "multiple candidates", "namespace"],
  conflict: ["collision", "ambiguous", "multiple tabs", "multiple apps"],
  implemented: ["current", "status", "implemented"],
  unimplemented: ["planned", "constraint", "not implemented", "roadmap"],
  responsibility: ["boundary", "Bridge owns", "browser app owns", "MCP client owns"],
  tls: ["WSS", "trusted certificate", "HTTPS", "secure page"],
  lna: ["local network access", "permission", "PNA", "loopback"],
};

// Stable technical identifiers and the source corpus remain English. These aliases let a
// localized site user search the same source-backed index with common terms in every supported
// display language without introducing a network translation service or changing document IDs.
const LOCALIZED_QUERY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  接続: ["connection", "connect"],
  認証: ["authentication", "token"],
  設定: ["configuration", "setup"],
  エラー: ["error", "troubleshooting"],
  セキュリティ: ["security"],
  ツール: ["tool"],
  リソース: ["resource"],
  プロンプト: ["prompt"],
  ペアリング: ["pairing", "origin"],
  証明書: ["certificate", "tls", "wss"],
  架构: ["architecture"],
  连接: ["connection", "connect"],
  认证: ["authentication", "token"],
  配置: ["configuration", "setup"],
  错误: ["error", "troubleshooting"],
  安全: ["security"],
  工具: ["tool"],
  资源: ["resource"],
  配对: ["pairing", "origin"],
  conexión: ["connection", "connect"],
  autenticación: ["authentication", "token"],
  configuración: ["configuration", "setup"],
  error: ["error", "troubleshooting"],
  seguridad: ["security"],
  herramienta: ["tool"],
  recurso: ["resource"],
  emparejamiento: ["pairing", "origin"],
  कनेक्शन: ["connection", "connect"],
  प्रमाणीकरण: ["authentication", "token"],
  विन्यास: ["configuration", "setup"],
  त्रुटि: ["error", "troubleshooting"],
  सुरक्षा: ["security"],
  उपकरण: ["tool"],
  संसाधन: ["resource"],
  اتصال: ["connection", "connect"],
  مصادقة: ["authentication", "token"],
  إعداد: ["configuration", "setup"],
  خطأ: ["error", "troubleshooting"],
  أمان: ["security"],
  أداة: ["tool"],
  مورد: ["resource"],
  conexão: ["connection", "connect"],
  autenticação: ["authentication", "token"],
  configuração: ["configuration", "setup"],
  segurança: ["security"],
  ferramenta: ["tool"],
  emparelhamento: ["pairing", "origin"],
  সংযোগ: ["connection", "connect"],
  প্রমাণীকরণ: ["authentication", "token"],
  কনফিগারেশন: ["configuration", "setup"],
  ত্রুটি: ["error", "troubleshooting"],
  নিরাপত্তা: ["security"],
  подключение: ["connection", "connect"],
  аутентификация: ["authentication", "token"],
  настройка: ["configuration", "setup"],
  ошибка: ["error", "troubleshooting"],
  безопасность: ["security"],
};

interface IndexedSection {
  readonly page: DocPage;
  readonly section: DocPage["sections"][number];
  readonly searchable: string;
  readonly normalized: string;
}

const normalize = (input: string): string =>
  input
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}._:/@-]+/gu, " ")
    .trim();

const tokenize = (input: string): readonly string[] => [
  ...new Set(
    normalize(input)
      .split(/\s+/u)
      .filter((term) => term.length > 1),
  ),
];

const index: readonly IndexedSection[] = docs.flatMap((page) =>
  page.sections.map((entry) => {
    const searchable = [
      page.id,
      page.title,
      page.description,
      entry.id,
      entry.title,
      entry.summary,
      ...entry.content,
      ...entry.tags,
      ...(entry.examples?.flatMap((example) => [
        example.id,
        example.title,
        example.code,
        example.explanation,
      ]) ?? []),
    ].join("\n");
    return { page, section: entry, searchable, normalized: normalize(searchable) };
  }),
);

const answer = <T>(data: T): DocsAnswer<T> => ({ ok: true, data, source: SOURCE });

export const docsHref = (logicalPath: string): string => `#${logicalPath}`;

const navigableSection = (
  page: DocPage,
  section: DocPage["sections"][number],
): NavigableDocSection => {
  const logicalPath = `${page.path}#${section.id}`;
  return { ...section, logicalPath, href: docsHref(logicalPath) };
};

export const navigablePage = (page: DocPage): NavigableDocPage => ({
  ...page,
  logicalPath: page.path,
  href: docsHref(page.path),
  sections: page.sections.map((section) => navigableSection(page, section)),
});

const relatedDocuments = (
  page: DocPage,
  sectionRelated: readonly string[] = [],
  limit = 5,
): readonly RelatedDocument[] => {
  const ids = [...sectionRelated, ...page.related]
    .map((reference) => reference.split("/")[0])
    .filter((id): id is string => id !== undefined && id !== page.id);

  return [...new Set(ids)]
    .map((id) => docsById.get(id))
    .filter((candidate): candidate is DocPage => candidate !== undefined)
    .slice(0, limit)
    .map((candidate) => ({
      pageId: candidate.id,
      title: candidate.title,
      path: candidate.path,
      logicalPath: candidate.path,
      href: docsHref(candidate.path),
      reason: `Related from ${page.title}`,
      status: candidate.status,
    }));
};

const notFound = (message: string, query = ""): DocsError => ({
  ok: false,
  error: {
    code: "NOT_FOUND",
    message,
    suggestions: searchDocs(query || "getting started", { limit: 3 }).map((result) => ({
      pageId: result.pageId,
      title: result.pageTitle,
      path: result.path,
      logicalPath: result.logicalPath,
      href: result.href,
      reason: "Closest indexed documentation",
      status: result.status,
    })),
  },
});

const excerptFor = (entry: IndexedSection, terms: readonly string[]): string => {
  const best =
    entry.section.content
      .map((paragraph) => ({
        paragraph,
        matches: terms.filter((term) => normalize(paragraph).includes(term)).length,
      }))
      .sort(
        (left, right) =>
          right.matches - left.matches || right.paragraph.length - left.paragraph.length,
      )[0]?.paragraph ?? entry.section.summary;
  return best.length > 360 ? `${best.slice(0, 357)}…` : best;
};

const expandTerms = (query: string): readonly string[] => {
  const direct = tokenize(query);
  const expanded = direct.flatMap((term) => SYNONYMS[term] ?? []);
  const normalizedQuery = normalize(query);
  const localized = Object.entries(LOCALIZED_QUERY_ALIASES)
    .filter(([term]) => normalizedQuery.includes(normalize(term)))
    .flatMap(([, aliases]) => aliases);
  return [...new Set([...direct, ...expanded.flatMap(tokenize), ...localized.flatMap(tokenize)])];
};

const scoreEntry = (
  entry: IndexedSection,
  query: string,
  terms: readonly string[],
): { readonly score: number; readonly matchedTerms: readonly string[] } => {
  const normalizedQuery = normalize(query);
  const title = normalize(`${entry.page.title} ${entry.section.title}`);
  const tags = normalize(entry.section.tags.join(" "));
  const matchedTerms = terms.filter((term) => entry.normalized.includes(term));
  let score = matchedTerms.length * 4;
  if (entry.normalized.includes(normalizedQuery)) score += 18;
  if (title.includes(normalizedQuery)) score += 20;
  if (terms.some((term) => title.includes(term))) score += 10;
  if (terms.some((term) => tags.includes(term))) score += 8;
  if (normalize(entry.page.id).includes(normalizedQuery)) score += 8;
  score += Math.max(0, 4 - entry.page.order / 10);
  return { score, matchedTerms };
};

export const searchDocs = (query: string, options: SearchOptions = {}): readonly SearchResult[] => {
  const trimmed = query.trim();
  if (trimmed.length === 0 || trimmed.length > 500) return [];
  const terms = expandTerms(trimmed);
  const limit = Math.max(1, Math.min(options.limit ?? 8, 25));
  const allowedKinds = options.kinds === undefined ? undefined : new Set(options.kinds);
  const allowedStatuses = options.statuses === undefined ? undefined : new Set(options.statuses);
  const allowedPages = options.pageIds === undefined ? undefined : new Set(options.pageIds);

  return index
    .filter(
      ({ page, section: entry }) =>
        (allowedKinds?.has(entry.kind) ?? true) &&
        (allowedStatuses?.has(entry.status) ?? true) &&
        (allowedPages?.has(page.id) ?? true),
    )
    .map((entry) => ({ entry, ...scoreEntry(entry, trimmed, terms) }))
    .filter(({ score, matchedTerms }) => score >= 4 && matchedTerms.length > 0)
    .sort(
      (left, right) => right.score - left.score || left.entry.page.order - right.entry.page.order,
    )
    .slice(0, limit)
    .map(({ entry, score, matchedTerms }) => {
      const logicalPath = `${entry.page.path}#${entry.section.id}`;
      return {
        pageId: entry.page.id,
        pageTitle: entry.page.title,
        sectionId: entry.section.id,
        heading: entry.section.title,
        summary: entry.section.summary,
        excerpt: excerptFor(entry, matchedTerms),
        path: logicalPath,
        logicalPath,
        href: docsHref(logicalPath),
        status: entry.section.status,
        kind: entry.section.kind,
        score: Math.round(score * 10) / 10,
        matchedTerms,
        related: relatedDocuments(entry.page, entry.section.related),
        source: entry.section.source ?? entry.page.source,
        examples: entry.section.examples ?? [],
      };
    });
};

export const getPage = (pageId: string): DocsResult<NavigableDocPage> => {
  const page = docsById.get(pageId);
  return page === undefined
    ? notFound(`Unknown documentation page: ${pageId}`, pageId)
    : answer(navigablePage(page));
};

export const getSection = (
  pageId: string,
  sectionId: string,
): DocsResult<{ readonly page: NavigableDocPage; readonly section: NavigableDocSection }> => {
  const page = docsById.get(pageId);
  if (page === undefined) return notFound(`Unknown documentation page: ${pageId}`, pageId);
  const entry = page.sections.find((candidate) => candidate.id === sectionId);
  return entry === undefined
    ? notFound(`Unknown section ${sectionId} in ${pageId}`, `${pageId} ${sectionId}`)
    : answer({ page: navigablePage(page), section: navigableSection(page, entry) });
};

export const searchApi = (query: string, limit = 8): readonly SearchResult[] =>
  searchDocs(query, { kinds: ["api", "configuration"], limit });

export const searchTypes = (query: string, limit = 8): readonly SearchResult[] =>
  searchDocs(query, {
    kinds: ["type", "api"],
    pageIds: ["api-reference", "bridge-protocol"],
    limit,
  });

export const findExamples = (query: string, limit = 8): readonly SearchResult[] =>
  searchDocs(query, { limit: 25 })
    .filter((result) => result.examples.length > 0)
    .slice(0, Math.max(1, Math.min(limit, 12)));

export const getRelated = (
  pageId: string,
  sectionId?: string,
): DocsResult<readonly RelatedDocument[]> => {
  const page = docsById.get(pageId);
  if (page === undefined) return notFound(`Unknown documentation page: ${pageId}`, pageId);
  const entry =
    sectionId === undefined ? undefined : page.sections.find((item) => item.id === sectionId);
  if (sectionId !== undefined && entry === undefined) {
    return notFound(`Unknown section ${sectionId} in ${pageId}`, `${pageId} ${sectionId}`);
  }
  return answer(relatedDocuments(page, entry?.related));
};

const uniqueResults = (results: readonly SearchResult[]): readonly SearchResult[] => [
  ...new Map(results.map((result) => [`${result.pageId}/${result.sectionId}`, result])).values(),
];

export const getImplementationGuide = (
  goal: string,
  environment = "local development",
): DocsResult<ImplementationGuide> => {
  if (goal.trim().length < 2 || goal.length > 500) {
    return {
      ok: false,
      error: { code: "INVALID_INPUT", message: "goal must be 2–500 characters", suggestions: [] },
    };
  }
  const steps = uniqueResults([
    ...searchDocs(goal, { kinds: ["guide", "api", "configuration", "example"], limit: 10 }),
    ...searchDocs("getting started first round trip", { limit: 4 }),
  ]).slice(0, 10);
  const prerequisites = searchDocs(`${environment} prerequisites requirements install`, {
    kinds: ["guide", "configuration"],
    limit: 5,
  });
  const cautions = searchDocs(`${goal} security constraint timeout origin`, {
    kinds: ["security", "status", "troubleshooting"],
    limit: 5,
  });
  const next = uniqueResults([...steps, ...cautions])
    .flatMap((result) => result.related)
    .slice(0, 6);
  return answer({ goal, environment, steps, prerequisites, cautions, next });
};

export const troubleshoot = (
  problem: string,
  environment = "browser and local cross-platform Bridge",
): DocsResult<TroubleshootingReport> => {
  if (problem.trim().length < 2 || problem.length > 500) {
    return {
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "problem must be 2–500 characters",
        suggestions: [],
      },
    };
  }
  const direct = searchDocs(`${problem} ${environment}`, {
    kinds: ["troubleshooting", "security", "configuration", "protocol"],
    limit: 12,
  });
  const order = searchDocs("diagnostic order listener pairing session registration routing", {
    pageIds: ["troubleshooting"],
    limit: 5,
  });
  const combined = uniqueResults([...direct, ...order]);
  const likelyCauses = combined.slice(0, 5);
  const checks = uniqueResults([...order, ...combined]).slice(0, 7);
  const remediation = combined.filter((result) => result.kind === "troubleshooting").slice(0, 6);
  const next = combined.flatMap((result) => result.related).slice(0, 6);
  return answer({ problem, likelyCauses, checks, remediation, next });
};

export const getResponsibilities = (topic: string): readonly SearchResult[] =>
  uniqueResults([
    ...searchDocs(`${topic} responsibility boundary`, {
      kinds: ["architecture", "security", "protocol"],
      limit: 10,
    }),
    ...searchDocs("Bridge owns browser app owns MCP client owns", {
      pageIds: ["architecture", "security-model"],
      limit: 4,
    }),
  ]).slice(0, 10);

export const getCapabilities = (
  query = "capabilities current planned constraints",
): CapabilitySummary => {
  const find = (status: "implemented" | "partial" | "planned" | "constraint") =>
    searchDocs(query, { statuses: [status], limit: 25 });
  return {
    implemented: find("implemented"),
    partial: find("partial"),
    planned: find("planned"),
    constraints: find("constraint"),
  };
};

export const docsIndex = docs.map((page) => ({
  id: page.id,
  title: page.title,
  description: page.description,
  path: page.path,
  logicalPath: page.path,
  href: docsHref(page.path),
  status: page.status,
  sections: page.sections.map((entry) => ({
    id: entry.id,
    title: entry.title,
    kind: entry.kind,
    status: entry.status,
    logicalPath: `${page.path}#${entry.id}`,
    href: docsHref(`${page.path}#${entry.id}`),
  })),
  related: page.related,
  source: page.source,
}));

export const docsStatus = {
  implemented: index.filter(({ section: entry }) => entry.status === "implemented").length,
  partial: index.filter(({ section: entry }) => entry.status === "partial").length,
  planned: index.filter(({ section: entry }) => entry.status === "planned").length,
  constraints: index.filter(({ section: entry }) => entry.status === "constraint").length,
  pages: docs.length,
  sections: index.length,
  version: DOCS_VERSION,
};

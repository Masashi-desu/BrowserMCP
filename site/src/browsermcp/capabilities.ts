import type {
  JsonObject,
  JsonValue,
  PromptHandlerResult,
  ResourceHandlerResult,
  ToolHandlerResult,
} from "@browsermcp/web";
import { docs, docsById } from "../docs/content.js";
import {
  docsIndex,
  docsStatus,
  findExamples,
  getCapabilities,
  getImplementationGuide,
  getPage,
  getRelated,
  getResponsibilities,
  getSection,
  navigablePage,
  searchApi,
  searchDocs,
  searchTypes,
  troubleshoot,
} from "../docs/engine.js";
import { SUPPORTED_LOCALES, type SupportedLocale, type TextDirection } from "../i18n/index.js";
import { getStoredValue, putStoredValue } from "../runtime/storage.js";
import { analyzeInWorker } from "../runtime/worker-client.js";

export interface SitePageSnapshot {
  readonly title: string;
  readonly path: string;
  readonly route: "landing" | "docs-index" | "docs-page" | "connection" | "not-found";
  readonly docPageId?: string;
  readonly hash: string;
  readonly locale: SupportedLocale;
  readonly direction: TextDirection;
}

export interface SiteRuntimeSnapshot {
  readonly origin: string;
  readonly pathname: string;
  readonly language: string;
  readonly online: boolean;
  readonly userAgent: string;
  readonly secureContext: boolean;
  readonly worker: boolean;
  readonly indexedDb: boolean;
  readonly webAssembly: boolean;
}

export interface SiteCapabilityContext {
  readonly getPageSnapshot: () => SitePageSnapshot;
  readonly getRuntimeSnapshot: () => SiteRuntimeSnapshot;
  readonly getConnectionSnapshot: () => unknown;
  readonly getRegistrationSnapshot: () => unknown;
}

export interface InvocationContextLike {
  readonly signal?: AbortSignal;
}

export interface SiteToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
  readonly annotations: SiteToolAnnotations;
  readonly handler: (args: unknown, context?: InvocationContextLike) => Promise<ToolHandlerResult>;
}

export interface SiteToolAnnotations extends JsonObject {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
  readonly openWorldHint: boolean;
}

export interface SiteResourceDefinition {
  readonly name: string;
  readonly uri: string;
  readonly description: string;
  readonly mimeType: "application/json";
  readonly handler: () => Promise<ResourceHandlerResult>;
}

export interface SitePromptDefinition {
  readonly name: string;
  readonly description: string;
  readonly arguments: readonly {
    readonly name: string;
    readonly description: string;
    readonly required: boolean;
  }[];
  readonly handler: (args: unknown) => Promise<PromptHandlerResult>;
}

const objectArgs = (args: unknown): Readonly<Record<string, unknown>> => {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    throw new Error("Arguments must be an object.");
  }
  return args as Readonly<Record<string, unknown>>;
};

const stringArg = (
  args: Readonly<Record<string, unknown>>,
  key: string,
  options: { readonly required?: boolean; readonly max?: number } = {},
): string | undefined => {
  const value = args[key];
  if (value === undefined && options.required !== true) return undefined;
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${key} must be a string.`);
  if (value.length > (options.max ?? 500)) throw new Error(`${key} is too long.`);
  return value;
};

const numberArg = (
  args: Readonly<Record<string, unknown>>,
  key: string,
  fallback: number,
  maximum: number,
): number => {
  const value = args[key];
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || typeof value !== "number" || value < 1 || value > maximum) {
    throw new Error(`${key} must be an integer from 1 to ${maximum}.`);
  }
  return value;
};

const canonicalJson = (value: unknown): JsonValue => {
  if (value === undefined) return null;
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return null;
  return JSON.parse(serialized) as JsonValue;
};

const structuredObject = (value: unknown): JsonObject => {
  const canonical = canonicalJson(value);
  return typeof canonical === "object" && canonical !== null && !Array.isArray(canonical)
    ? (canonical as JsonObject)
    : Array.isArray(canonical)
      ? { results: canonical }
      : { value: canonical };
};

const mcpResult = (value: unknown): ToolHandlerResult => {
  const structuredContent = structuredObject(value);
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
};

const jsonResource = (uri: string, value: unknown): ResourceHandlerResult => ({
  contents: [
    { uri, mimeType: "application/json", text: JSON.stringify(canonicalJson(value), null, 2) },
  ],
});

const objectSchema = (
  properties: JsonObject = {},
  required: readonly string[] = [],
): JsonObject => ({
  type: "object",
  properties,
  ...(required.length > 0 ? { required: [...required] } : {}),
  additionalProperties: false,
});

const READ_ONLY_TOOL_ANNOTATIONS: SiteToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const STORAGE_WRITE_TOOL_ANNOTATIONS: SiteToolAnnotations = {
  readOnlyHint: false,
  // A put can overwrite the named entry and evict oldest entries at the per-Origin quota.
  destructiveHint: true,
  // updatedAt and quota eviction make identical calls observably non-idempotent.
  idempotentHint: false,
  openWorldHint: false,
};

const STORAGE_READ_CLEANUP_TOOL_ANNOTATIONS: SiteToolAnnotations = {
  // Validation normally reads, but a tampered record is removed in the same transaction.
  readOnlyHint: false,
  destructiveHint: true,
  // First tampered read rejects/removes; the next returns undefined.
  idempotentHint: false,
  openWorldHint: false,
};

export const createSiteTools = (context: SiteCapabilityContext): readonly SiteToolDefinition[] => {
  const definitions: readonly Omit<SiteToolDefinition, "annotations">[] = [
    {
      name: "docs_search",
      description:
        "Search the structured BrowserMCP documentation corpus across pages and sections.",
      inputSchema: objectSchema(
        {
          query: { type: "string", minLength: 1, maxLength: 500 },
          limit: { type: "integer", minimum: 1, maximum: 25, default: 8 },
        },
        ["query"],
      ),
      handler: async (raw) => {
        const args = objectArgs(raw);
        return mcpResult(
          searchDocs(stringArg(args, "query", { required: true }) ?? "", {
            limit: numberArg(args, "limit", 8, 25),
          }),
        );
      },
    },
    {
      name: "docs_get_page",
      description: "Get one structured documentation page by stable page ID.",
      inputSchema: objectSchema({ pageId: { type: "string", minLength: 1, maxLength: 80 } }, [
        "pageId",
      ]),
      handler: async (raw) => {
        const args = objectArgs(raw);
        return mcpResult(getPage(stringArg(args, "pageId", { required: true, max: 80 }) ?? ""));
      },
    },
    {
      name: "docs_get_section",
      description:
        "Get an exact page section with content, code, source, related items, and status.",
      inputSchema: objectSchema(
        {
          pageId: { type: "string", minLength: 1, maxLength: 80 },
          sectionId: { type: "string", minLength: 1, maxLength: 80 },
        },
        ["pageId", "sectionId"],
      ),
      handler: async (raw) => {
        const args = objectArgs(raw);
        return mcpResult(
          getSection(
            stringArg(args, "pageId", { required: true, max: 80 }) ?? "",
            stringArg(args, "sectionId", { required: true, max: 80 }) ?? "",
          ),
        );
      },
    },
    {
      name: "docs_search_api",
      description: "Search public APIs, configuration calls, and handler contracts.",
      inputSchema: objectSchema({ query: { type: "string", minLength: 1, maxLength: 500 } }, [
        "query",
      ]),
      handler: async (raw) => {
        const args = objectArgs(raw);
        return mcpResult(searchApi(stringArg(args, "query", { required: true }) ?? ""));
      },
    },
    {
      name: "docs_search_types",
      description: "Find BrowserMCP public and Bridge Protocol type definitions.",
      inputSchema: objectSchema({ query: { type: "string", minLength: 1, maxLength: 500 } }, [
        "query",
      ]),
      handler: async (raw) => {
        const args = objectArgs(raw);
        return mcpResult(searchTypes(stringArg(args, "query", { required: true }) ?? ""));
      },
    },
    {
      name: "docs_find_examples",
      description: "Find relevant code examples with their source page and section.",
      inputSchema: objectSchema({ query: { type: "string", minLength: 1, maxLength: 500 } }, [
        "query",
      ]),
      handler: async (raw) => {
        const args = objectArgs(raw);
        return mcpResult(findExamples(stringArg(args, "query", { required: true }) ?? ""));
      },
    },
    {
      name: "docs_troubleshoot",
      description:
        "Diagnose Bridge connection, Origin, authentication, version, routing, or handler failures.",
      inputSchema: objectSchema(
        {
          problem: { type: "string", minLength: 2, maxLength: 500 },
          environment: { type: "string", maxLength: 300 },
        },
        ["problem"],
      ),
      handler: async (raw) => {
        const args = objectArgs(raw);
        return mcpResult(
          troubleshoot(
            stringArg(args, "problem", { required: true }) ?? "",
            stringArg(args, "environment", { max: 300 }),
          ),
        );
      },
    },
    {
      name: "docs_implementation_guide",
      description:
        "Build a source-backed, multi-page implementation guide for a goal and environment.",
      inputSchema: objectSchema(
        {
          goal: { type: "string", minLength: 2, maxLength: 500 },
          environment: { type: "string", maxLength: 300 },
        },
        ["goal"],
      ),
      handler: async (raw) => {
        const args = objectArgs(raw);
        return mcpResult(
          getImplementationGuide(
            stringArg(args, "goal", { required: true }) ?? "",
            stringArg(args, "environment", { max: 300 }),
          ),
        );
      },
    },
    {
      name: "docs_responsibility",
      description:
        "Identify whether a concern belongs to the client, Bridge, web library, or browser app.",
      inputSchema: objectSchema({ topic: { type: "string", minLength: 1, maxLength: 500 } }, [
        "topic",
      ]),
      handler: async (raw) => {
        const args = objectArgs(raw);
        return mcpResult(getResponsibilities(stringArg(args, "topic", { required: true }) ?? ""));
      },
    },
    {
      name: "docs_capabilities",
      description:
        "Distinguish implemented, partial, planned, and constrained BrowserMCP capabilities.",
      inputSchema: objectSchema({ query: { type: "string", maxLength: 500 } }),
      handler: async (raw) => {
        const args = objectArgs(raw);
        return mcpResult(getCapabilities(stringArg(args, "query") ?? undefined));
      },
    },
    {
      name: "docs_related",
      description: "Find the next documentation pages related to a page or exact section.",
      inputSchema: objectSchema(
        {
          pageId: { type: "string", minLength: 1, maxLength: 80 },
          sectionId: { type: "string", maxLength: 80 },
        },
        ["pageId"],
      ),
      handler: async (raw) => {
        const args = objectArgs(raw);
        return mcpResult(
          getRelated(
            stringArg(args, "pageId", { required: true, max: 80 }) ?? "",
            stringArg(args, "sectionId", { max: 80 }),
          ),
        );
      },
    },
    {
      name: "site_current_page",
      description: "Get the currently visible BrowserMCP site route and documentation context.",
      inputSchema: objectSchema(),
      handler: async () => mcpResult(context.getPageSnapshot()),
    },
    {
      name: "site_structure",
      description:
        "List landing, documentation, and connection routes without changing browser navigation.",
      inputSchema: objectSchema(),
      handler: async () =>
        mcpResult({
          localization: {
            displayLocale: context.getPageSnapshot().locale,
            direction: context.getPageSnapshot().direction,
            displayContentLocale: context.getPageSnapshot().locale,
            technicalContentLocale: "en",
            canonicalCorpusLocale: "en",
            codeAndIdentifierLocale: "en",
            mcpContentLocale: "en",
            supportedLocales: SUPPORTED_LOCALES,
          },
          routes: [
            { path: "/", title: "Landing" },
            { path: "/docs", title: "Documentation", children: docsIndex },
            { path: "/connection", title: "Connection status" },
          ],
        }),
    },
    {
      name: "site_navigation",
      description:
        "Get navigation context for the current route, including adjacent docs pages, without changing the page.",
      inputSchema: objectSchema(),
      handler: async () => {
        const current = context.getPageSnapshot();
        const page = current.docPageId === undefined ? undefined : docsById.get(current.docPageId);
        const previous = page === undefined ? undefined : docs[page.order - 2];
        const next = page === undefined ? undefined : docs[page.order];
        return mcpResult({
          current,
          breadcrumbs:
            page === undefined
              ? [{ title: current.title, path: current.path }]
              : [
                  { title: "Documentation", path: "/docs" },
                  { title: page.title, path: page.path },
                ],
          previous: previous === undefined ? null : { title: previous.title, path: previous.path },
          next: next === undefined ? null : { title: next.title, path: next.path },
        });
      },
    },
    {
      name: "site_runtime",
      description: "Inspect safe browser runtime capability and page environment information.",
      inputSchema: objectSchema(),
      handler: async () =>
        mcpResult({
          ...context.getRuntimeSnapshot(),
          displayLocale: context.getPageSnapshot().locale,
          direction: context.getPageSnapshot().direction,
          supportedDisplayLocales: SUPPORTED_LOCALES,
        }),
    },
    {
      name: "site_status",
      description:
        "Inspect Bridge connection, session, and registration snapshots for this site app.",
      inputSchema: objectSchema(),
      handler: async () =>
        mcpResult({
          connection: context.getConnectionSnapshot(),
          registrations: context.getRegistrationSnapshot(),
        }),
    },
    {
      name: "site_storage_put",
      description:
        "Store a small JSON value in this Origin's IndexedDB; secret-like keys and string values are rejected.",
      inputSchema: objectSchema(
        { key: { type: "string", minLength: 1, maxLength: 120 }, value: {} },
        ["key", "value"],
      ),
      handler: async (raw) => {
        const args = objectArgs(raw);
        const key = stringArg(args, "key", { required: true, max: 120 }) ?? "";
        return mcpResult(await putStoredValue(key, args.value));
      },
    },
    {
      name: "site_storage_get",
      description:
        "Read a small JSON value from the site IndexedDB demonstration; a tampered record is removed and the call rejects.",
      inputSchema: objectSchema({ key: { type: "string", minLength: 1, maxLength: 120 } }, ["key"]),
      handler: async (raw) => {
        const args = objectArgs(raw);
        return mcpResult(
          await getStoredValue(stringArg(args, "key", { required: true, max: 120 }) ?? ""),
        );
      },
    },
    {
      name: "site_worker_analyze",
      description: "Analyze bounded text in a dedicated Web Worker without evaluating code.",
      inputSchema: objectSchema({ text: { type: "string", maxLength: 100_000 } }, ["text"]),
      handler: async (raw, invocation) => {
        const args = objectArgs(raw);
        return mcpResult(
          await analyzeInWorker(
            stringArg(args, "text", { required: true, max: 100_000 }) ?? "",
            invocation?.signal,
          ),
        );
      },
    },
  ];
  return definitions.map((definition) => {
    const schemaProperties = definition.inputSchema.properties;
    const allowedKeys = new Set(
      typeof schemaProperties === "object" &&
        schemaProperties !== null &&
        !Array.isArray(schemaProperties)
        ? Object.keys(schemaProperties)
        : [],
    );
    return {
      ...definition,
      annotations:
        definition.name === "site_storage_put"
          ? STORAGE_WRITE_TOOL_ANNOTATIONS
          : definition.name === "site_storage_get"
            ? STORAGE_READ_CLEANUP_TOOL_ANNOTATIONS
            : READ_ONLY_TOOL_ANNOTATIONS,
      handler: async (raw: unknown, invocation?: InvocationContextLike) => {
        const args = objectArgs(raw);
        if (Object.keys(args).some((key) => !allowedKeys.has(key))) {
          throw new Error("Arguments contain fields not declared by this Tool schema.");
        }
        return await definition.handler(raw, invocation);
      },
    };
  });
};

export const createSiteResources = (
  context: SiteCapabilityContext,
): readonly SiteResourceDefinition[] => {
  const fixed: readonly SiteResourceDefinition[] = [
    {
      name: "docs.index",
      uri: "browsermcp://docs/index",
      description: "Structured page and section index for the complete documentation corpus.",
      mimeType: "application/json",
      handler: async () => jsonResource("browsermcp://docs/index", docsIndex),
    },
    {
      name: "docs.status",
      uri: "browsermcp://docs/status",
      description:
        "Counts and status distinctions for implemented, partial, planned, and constrained documentation.",
      mimeType: "application/json",
      handler: async () =>
        jsonResource("browsermcp://docs/status", {
          summary: docsStatus,
          capabilities: getCapabilities(),
        }),
    },
    {
      name: "site.current_page",
      uri: "browsermcp://site/current-page",
      description: "Live route and document context for the visible tab.",
      mimeType: "application/json",
      handler: async () =>
        jsonResource("browsermcp://site/current-page", context.getPageSnapshot()),
    },
    {
      name: "site.status",
      uri: "browsermcp://site/status",
      description: "Live connection, session, and capability registration state.",
      mimeType: "application/json",
      handler: async () =>
        jsonResource("browsermcp://site/status", {
          connection: context.getConnectionSnapshot(),
          registrations: context.getRegistrationSnapshot(),
          runtime: context.getRuntimeSnapshot(),
        }),
    },
  ];
  return [
    ...fixed,
    ...docs.map((page) => {
      const uri = `browsermcp://docs/page/${page.id}`;
      return {
        name: `docs.page.${page.id}`,
        uri,
        description: page.description,
        mimeType: "application/json" as const,
        handler: async () => jsonResource(uri, navigablePage(page)),
      };
    }),
  ];
};

const promptResult = (text: string): PromptHandlerResult => ({
  messages: [{ role: "user", content: { type: "text", text } }],
});

export const createSitePrompts = (): readonly SitePromptDefinition[] => [
  {
    name: "browsermcp_get_started",
    description:
      "Guide a developer through a source-backed BrowserMCP setup for their environment.",
    arguments: [
      {
        name: "environment",
        description: "Operating system, browser, bundler, and MCP client.",
        required: true,
      },
    ],
    handler: async (raw) => {
      const args = objectArgs(raw);
      const environment = stringArg(args, "environment", { required: true, max: 500 }) ?? "";
      return promptResult(
        `Create a BrowserMCP setup guide for this environment: ${environment}. Use docs_implementation_guide, cite each pageId/sectionId/path, verify the exact Origin, and distinguish implemented features from constraints.`,
      );
    },
  },
  {
    name: "browsermcp_implement",
    description:
      "Guide implementation of a BrowserMCP Tool, Resource, Prompt, or lifecycle feature.",
    arguments: [
      { name: "goal", description: "The feature to implement.", required: true },
      {
        name: "environment",
        description: "The target browser and app environment.",
        required: false,
      },
    ],
    handler: async (raw) => {
      const args = objectArgs(raw);
      const goal = stringArg(args, "goal", { required: true, max: 500 }) ?? "";
      const environment = stringArg(args, "environment", { max: 500 }) ?? "unspecified environment";
      return promptResult(
        `Implement this BrowserMCP goal: ${goal}. Environment: ${environment}. Query docs_search_api, docs_search_types, docs_find_examples, docs_responsibility, and docs_capabilities. Cite source page and section paths, honor security constraints, and do not move app business logic into the Bridge.`,
      );
    },
  },
  {
    name: "browsermcp_diagnose",
    description: "Diagnose a BrowserMCP connection, auth, routing, or execution problem.",
    arguments: [
      { name: "problem", description: "Observed behavior or safe error message.", required: true },
      {
        name: "environment",
        description: "Browser, page Origin, and Bridge mode; omit all secrets.",
        required: false,
      },
    ],
    handler: async (raw) => {
      const args = objectArgs(raw);
      const problem = stringArg(args, "problem", { required: true, max: 500 }) ?? "";
      const environment = stringArg(args, "environment", { max: 500 }) ?? "unspecified environment";
      return promptResult(
        `Diagnose: ${problem}. Environment: ${environment}. Use docs_troubleshoot and follow listener → exact Origin → token/session → negotiation → registration → routing → handler order. Cite pageId/sectionId/path. Do not request or reveal a token.`,
      );
    },
  },
  {
    name: "browsermcp_review_boundaries",
    description:
      "Review whether proposed logic belongs in the MCP client, Bridge, web library, or app.",
    arguments: [
      {
        name: "proposal",
        description: "The proposed behavior or code responsibility.",
        required: true,
      },
    ],
    handler: async (raw) => {
      const args = objectArgs(raw);
      const proposal = stringArg(args, "proposal", { required: true, max: 500 }) ?? "";
      return promptResult(
        `Review this BrowserMCP responsibility: ${proposal}. Use docs_responsibility and docs_related, cite architecture/responsibility-boundaries, identify trust boundaries, and reject app-specific business logic in the common Bridge.`,
      );
    },
  },
];

export const SITE_CAPABILITY_COUNTS = {
  tools: 19,
  resources: docs.length + 4,
  prompts: 4,
} as const;

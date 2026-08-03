import { BrowserMCP } from "@browsermcp/web";
import { describe, expect, it, vi } from "vitest";
import {
  createSiteResources,
  createSiteTools,
  SITE_CAPABILITY_COUNTS,
  type SiteCapabilityContext,
} from "../src/browsermcp/capabilities.js";
import {
  type BrowserMcpRegistrar,
  registerSiteCapabilities,
} from "../src/browsermcp/registration.js";
import { RubiksCubeBenchmark } from "../src/runtime/rubiks-cube.js";
import { SiteFakeBridge } from "./fake-bridge.js";

const rubiksCube = new RubiksCubeBenchmark({
  initialScrambleLength: 0,
  random: () => 0.5,
  animationDurationMs: 0,
});

const context: SiteCapabilityContext = {
  getPageSnapshot: () => ({
    title: "Tools",
    path: "/docs/tools",
    route: "docs-page",
    docPageId: "tools",
    hash: "register-tool",
    locale: "en",
    direction: "ltr",
  }),
  getRuntimeSnapshot: () => ({
    origin: "https://example.github.io",
    pathname: "/BrowserMCP/",
    language: "en",
    online: true,
    userAgent: "test",
    secureContext: true,
    worker: true,
    indexedDb: true,
    webAssembly: true,
  }),
  getConnectionSnapshot: () => ({ connectionState: "connected", session: { id: "redacted" } }),
  getRegistrationSnapshot: () => SITE_CAPABILITY_COUNTS,
  rubiksCube,
};

const tools = createSiteTools(context);
const tool = (name: string) => {
  const definition = tools.find((candidate) => candidate.name === name);
  if (definition === undefined) throw new Error(`Missing tool ${name}`);
  return definition;
};

const data = async (name: string, args: unknown): Promise<unknown> => {
  const result = (await tool(name).handler(args)) as { readonly structuredContent: unknown };
  return result.structuredContent;
};

describe("site Tool annotations", () => {
  it("marks read-only, cube-mutating, reset, and quota-mutating tools accurately", () => {
    const cubeActions = new Set([
      "rubiks_cube_apply_moves",
      "rubiks_cube_scramble",
      "rubiks_cube_set_autoplay",
    ]);
    for (const definition of tools.filter(
      ({ name }) =>
        name !== "site_storage_put" &&
        name !== "site_storage_get" &&
        name !== "rubiks_cube_reset" &&
        !cubeActions.has(name),
    )) {
      expect(definition.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
    for (const name of cubeActions) {
      expect(tool(name).annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      });
    }
    expect(tool("rubiks_cube_reset").annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });
    expect(tool("site_storage_put").annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });
    expect(tool("site_storage_get").annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });
  });
});

describe("Rubik's Cube MCP capabilities", () => {
  it("keeps apply, get-state, and the live state Resource on one canonical snapshot", async () => {
    await data("rubiks_cube_reset", { mode: "solved" });
    const applied = (await data("rubiks_cube_apply_moves", {
      moves: "R U R' U' F2",
      animated: false,
    })) as {
      readonly appliedMoves: readonly string[];
      readonly state: Readonly<Record<string, unknown>>;
    };
    const toolState = (await data("rubiks_cube_get_state", {})) as Readonly<
      Record<string, unknown>
    >;
    const stateResource = createSiteResources(context).find(
      ({ uri }) => uri === "browsermcp://benchmark/rubiks-cube/state",
    );
    if (stateResource === undefined) throw new Error("Missing Rubik's Cube state Resource");
    const resourceResult = await stateResource.handler();
    const resourceContent = resourceResult.contents[0];
    if (resourceContent === undefined || !("text" in resourceContent)) {
      throw new Error("Rubik's Cube state Resource was not JSON text");
    }
    const resourceState = JSON.parse(resourceContent.text) as Readonly<Record<string, unknown>>;

    expect(applied.appliedMoves).toEqual(["R", "U", "R'", "U'", "F2"]);
    expect(applied.state).toEqual(toolState);
    expect(resourceState).toEqual(toolState);
    expect(toolState).toMatchObject({
      schemaVersion: 1,
      cubeSize: 3,
      faceletOrder: "URFDLB",
      isSolved: false,
      phase: "idle",
      queuedMoves: 0,
    });
  });

  it("reproduces seeded reset and scramble states", async () => {
    const seededReset = (await data("rubiks_cube_reset", {
      mode: "scrambled",
      seed: "mcp-repeatable-seed",
      length: 18,
    })) as {
      readonly faceletString: string;
      readonly stateId: string;
      readonly scramble: { readonly moves: readonly string[] };
    };
    await data("rubiks_cube_reset", { mode: "solved" });
    const repeatedReset = (await data("rubiks_cube_reset", {
      mode: "scrambled",
      seed: "mcp-repeatable-seed",
      length: 18,
    })) as typeof seededReset;

    const seededScramble = (await data("rubiks_cube_scramble", {
      seed: "mcp-repeatable-seed",
      length: 18,
      animated: false,
    })) as {
      readonly scrambleMoves: readonly string[];
      readonly state: { readonly faceletString: string; readonly stateId: string };
    };
    const repeatedScramble = (await data("rubiks_cube_scramble", {
      seed: "mcp-repeatable-seed",
      length: 18,
      animated: false,
    })) as typeof seededScramble;

    expect(repeatedReset.faceletString).toBe(seededReset.faceletString);
    expect(repeatedReset.stateId).toBe(seededReset.stateId);
    expect(repeatedReset.scramble.moves).toEqual(seededReset.scramble.moves);
    expect(seededScramble.state.faceletString).toBe(seededReset.faceletString);
    expect(seededScramble.state.stateId).toBe(seededReset.stateId);
    expect(seededScramble.scrambleMoves).toEqual(seededReset.scramble.moves);
    expect(repeatedScramble.state.faceletString).toBe(seededScramble.state.faceletString);
    expect(repeatedScramble.state.stateId).toBe(seededScramble.state.stateId);
    expect(repeatedScramble.scrambleMoves).toEqual(seededScramble.scrambleMoves);
  });

  it("rejects undeclared fields, malformed moves, and bounded cube inputs", async () => {
    await expect(
      tool("rubiks_cube_apply_moves").handler({
        moves: "R",
        animated: false,
        undeclared: true,
      }),
    ).rejects.toThrow(/not declared/u);
    await expect(
      tool("rubiks_cube_apply_moves").handler({ moves: "R X", animated: false }),
    ).rejects.toThrow(/canonical/u);
    await expect(
      tool("rubiks_cube_apply_moves").handler({
        moves: Array.from({ length: 33 }, () => "R").join(" "),
        animated: false,
      }),
    ).rejects.toThrow(/at most 32/u);
    await expect(
      tool("rubiks_cube_scramble").handler({ length: 41, animated: false }),
    ).rejects.toThrow(/1 to 40/u);
    await expect(
      tool("rubiks_cube_reset").handler({ mode: "scrambled", length: 101 }),
    ).rejects.toThrow(/1 to 100/u);
    await expect(
      tool("rubiks_cube_set_autoplay").handler({ enabled: true, intervalMs: 499 }),
    ).rejects.toThrow(/500 to 30000/u);
  });
});

describe("Docs MCP required evaluation cases", () => {
  it("rejects Tool arguments not declared by additionalProperties false schemas", async () => {
    await expect(
      tool("docs_search").handler({ query: "Origin", undeclared: true }),
    ).rejects.toThrow(/not declared/u);
  });

  it("1. gets initial setup instructions", async () => {
    const result = await data("docs_implementation_guide", {
      goal: "initial setup and first round trip",
      environment: "local macOS Vite",
    });
    expect(JSON.stringify(result)).toContain("getting-started");
  });

  it("2. gets Tool registration instructions and code", async () => {
    const result = await data("docs_find_examples", { query: "register tool app.tool" });
    expect(JSON.stringify(result)).toContain("tool-registration");
  });

  it("3. gets MCP client configuration", async () => {
    const result = await data("docs_search", {
      query: "configure MCP client Streamable HTTP",
      limit: 10,
    });
    expect(JSON.stringify(result)).toContain("configuring-mcp-client");
    expect(JSON.stringify(result)).toContain("127.0.0.1:8789/mcp");
  });

  it("4. investigates a disconnected Bridge", async () => {
    const result = await data("docs_troubleshoot", {
      problem: "Bridge is not connected and tools are absent",
    });
    expect(JSON.stringify(result)).toContain("bridge-not-connected");
  });

  it("5. gets exact Origin error remediation", async () => {
    const result = await data("docs_troubleshoot", {
      problem: "Origin rejected localhost port mismatch",
    });
    expect(JSON.stringify(result)).toContain("origin-error");
  });

  it("6. gets authentication error remediation", async () => {
    const result = await data("docs_troubleshoot", {
      problem: "authentication failed expired token",
    });
    expect(JSON.stringify(result)).toContain("authentication-error");
  });

  it("7. explains multiple-app name collisions", async () => {
    const result = await data("docs_search", {
      query: "multiple apps tool name collision ambiguous tab",
      limit: 10,
    });
    expect(JSON.stringify(result)).toContain("namespacing");
    expect(JSON.stringify(result)).toContain("no instance-selection");
    expect(JSON.stringify(result)).toContain("duplicate tabs");
  });

  it("8. separates implemented and unimplemented capabilities", async () => {
    const result = (await data("docs_capabilities", {})) as {
      readonly implemented: readonly unknown[];
      readonly planned: readonly unknown[];
      readonly constraints: readonly unknown[];
    };
    expect(result.implemented.length).toBeGreaterThan(0);
    expect(result.planned.length).toBeGreaterThan(0);
    expect(result.constraints.length).toBeGreaterThan(0);
  });

  it("9. gathers evidence across multiple documents", async () => {
    const result = (await data("docs_search", {
      query: "pair connect authenticate register capability",
      limit: 20,
    })) as {
      readonly results: readonly { readonly pageId: string }[];
    };
    expect(new Set(result.results.map(({ pageId }) => pageId)).size).toBeGreaterThanOrEqual(3);
  });

  it("10. identifies the source page and exact section", async () => {
    const result = await data("docs_get_section", { pageId: "tools", sectionId: "register-tool" });
    expect(JSON.stringify(result)).toContain('"page"');
    expect(JSON.stringify(result)).toContain('"register-tool"');
    expect(JSON.stringify(result)).toContain("docs/specification.md");
    expect(JSON.stringify(result)).toContain('"href":"#/docs/tools#register-tool"');
  });
});

describe("site-wide MCP registration", () => {
  it("exposes display locale metadata and accepts localized Docs queries", async () => {
    const current = (await data("site_current_page", {})) as {
      readonly locale: string;
      readonly direction: string;
    };
    const structure = (await data("site_structure", {})) as {
      readonly localization: {
        readonly displayLocale: string;
        readonly displayContentLocale: string;
        readonly technicalContentLocale: string;
        readonly canonicalCorpusLocale: string;
        readonly codeAndIdentifierLocale: string;
        readonly mcpContentLocale: string;
        readonly supportedLocales: readonly string[];
      };
    };
    const runtime = (await data("site_runtime", {})) as {
      readonly displayLocale: string;
      readonly supportedDisplayLocales: readonly string[];
    };
    const localizedSearch = (await data("docs_search", {
      query: "接続 認証",
      limit: 5,
    })) as { readonly results: readonly unknown[] };

    expect(current).toMatchObject({ locale: "en", direction: "ltr" });
    expect(structure.localization).toMatchObject({
      displayLocale: "en",
      displayContentLocale: "en",
      technicalContentLocale: "en",
      canonicalCorpusLocale: "en",
      codeAndIdentifierLocale: "en",
      mcpContentLocale: "en",
    });
    expect(structure.localization.supportedLocales).toHaveLength(9);
    expect(runtime).toMatchObject({ displayLocale: "en" });
    expect(runtime.supportedDisplayLocales).toEqual(structure.localization.supportedLocales);
    expect(localizedSearch.results.length).toBeGreaterThan(0);
  });

  it("registers every tool, page resource, and prompt once and unregisters all", async () => {
    const kinds = {
      tools: [] as string[],
      resources: [] as string[],
      prompts: [] as string[],
      removed: [] as string[],
    };
    const createHandle = (id: string) => ({
      id,
      ready: Promise.resolve(),
      unregister: async () => {
        kinds.removed.push(id);
      },
    });
    const app: BrowserMcpRegistrar = {
      tool: (definition) => {
        kinds.tools.push(definition.name);
        return createHandle(`tool:${definition.name}`);
      },
      resource: (definition) => {
        kinds.resources.push(definition.uri);
        return createHandle(`resource:${definition.uri}`);
      },
      prompt: (definition) => {
        kinds.prompts.push(definition.name);
        return createHandle(`prompt:${definition.name}`);
      },
    };
    const registration = registerSiteCapabilities(app, context);
    await registration.ready;
    expect(kinds.tools).toHaveLength(SITE_CAPABILITY_COUNTS.tools);
    expect(kinds.resources).toHaveLength(SITE_CAPABILITY_COUNTS.resources);
    expect(kinds.prompts).toHaveLength(SITE_CAPABILITY_COUNTS.prompts);
    expect(new Set([...kinds.tools, ...kinds.resources, ...kinds.prompts]).size).toBe(
      SITE_CAPABILITY_COUNTS.tools +
        SITE_CAPABILITY_COUNTS.resources +
        SITE_CAPABILITY_COUNTS.prompts,
    );
    await registration.unregister();
    expect(kinds.removed).toHaveLength(registration.handles.length);
  });

  it("publishes one resource for each structured docs page", () => {
    const resources = createSiteResources(context);
    expect(resources.filter(({ uri }) => uri.startsWith("browsermcp://docs/page/"))).toHaveLength(
      19,
    );
  });

  it("round-trips a Docs result through BrowserMCP and validated Bridge Protocol messages", async () => {
    const bridge = new SiteFakeBridge();
    const app = new BrowserMCP({
      appId: "app:browsermcp-site-integration",
      name: "BrowserMCP Site Integration",
      version: "0.1.0",
      origin: "https://example.github.io",
      bridgeUrl: "wss://127.0.0.1:8789/browser",
      webSocketFactory: bridge.factory,
      reconnect: false,
    });
    const registration = registerSiteCapabilities(app, context);
    await app.connect();
    await registration.ready;
    const docsSearch = app
      .getRegistrations()
      .find(({ kind, name }) => kind === "tool" && name === "docs_search");
    expect(docsSearch).toBeDefined();
    bridge.sendInvoke({
      invocationId: "site-docs-search-round-trip",
      registrationId: docsSearch?.id ?? "missing",
      operation: {
        kind: "tool.call",
        arguments: { query: "Origin arbitrary-user-secret-value", limit: 5 },
      },
    });
    await vi.waitFor(() => {
      const message = bridge.received.find(
        (candidate) =>
          candidate.type === "result" &&
          candidate.payload.invocationId === "site-docs-search-round-trip",
      );
      expect(message?.type).toBe("result");
      if (message?.type !== "result") return;
      expect(message.payload.output.kind).toBe("tool");
      if (message.payload.output.kind !== "tool") return;
      expect(message.payload.output.structuredContent).toEqual(
        expect.objectContaining({ results: expect.any(Array) }),
      );
    });
    expect(
      bridge.received.some(
        (message) =>
          message.type === "error" &&
          message.payload.invocationId === "site-docs-search-round-trip",
      ),
    ).toBe(false);
    const resultLog = app.getLogs().find(({ event }) => event === "handler.site.result");
    expect(resultLog?.data).toMatchObject({
      kind: "tool",
      name: "docs_search",
      contentItems: 1,
      structuredContentPresent: true,
      sizeBucket: expect.any(String),
    });
    expect(JSON.stringify(app.getLogs())).not.toContain("arbitrary-user-secret-value");
    await app.disconnect();
    await registration.unregister();
  });
});

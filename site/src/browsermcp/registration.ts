import type {
  InvocationContext,
  RegistrationHandle,
  WebPromptDefinition,
  WebResourceDefinition,
  WebToolDefinition,
} from "@browsermcp/web";
import {
  createSitePrompts,
  createSiteResources,
  createSiteTools,
  type SiteCapabilityContext,
} from "./capabilities.js";

export type RegistrationHandleLike = RegistrationHandle;

export interface BrowserMcpRegistrar {
  tool: (definition: WebToolDefinition) => RegistrationHandle;
  resource: (definition: WebResourceDefinition) => RegistrationHandle;
  prompt: (definition: WebPromptDefinition) => RegistrationHandle;
}

export interface SiteRegistration {
  readonly handles: readonly RegistrationHandleLike[];
  readonly names: {
    readonly tools: readonly string[];
    readonly resources: readonly string[];
    readonly prompts: readonly string[];
  };
  readonly ready: Promise<void>;
  unregister: () => Promise<void>;
}

export const resultMetadata = (
  value: unknown,
): Readonly<Record<string, number | boolean | string>> => {
  const record =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Readonly<Record<string, unknown>>)
      : {};
  let bytes: number | undefined;
  try {
    const serialized = JSON.stringify(value);
    if (serialized !== undefined) bytes = new TextEncoder().encode(serialized).byteLength;
  } catch {
    bytes = undefined;
  }
  const sizeBucket =
    bytes === undefined
      ? "unavailable"
      : bytes < 1_024
        ? "under-1-kib"
        : bytes < 4_096
          ? "1-4-kib"
          : bytes < 16_384
            ? "4-16-kib"
            : "16-kib-or-more";
  return {
    contentItems: Array.isArray(record.content) ? record.content.length : 0,
    resourceContents: Array.isArray(record.contents) ? record.contents.length : 0,
    promptMessages: Array.isArray(record.messages) ? record.messages.length : 0,
    structuredContentPresent: record.structuredContent !== undefined,
    sizeBucket,
  };
};

export const registerSiteCapabilities = (
  app: BrowserMcpRegistrar,
  context: SiteCapabilityContext,
): SiteRegistration => {
  const toolDefinitions = createSiteTools(context);
  const resourceDefinitions = createSiteResources(context);
  const promptDefinitions = createSitePrompts();

  const handles: RegistrationHandleLike[] = [];
  try {
    for (const definition of toolDefinitions) {
      handles.push(
        app.tool({
          ...definition,
          handler: async (args, invocation: InvocationContext) => {
            const result = await definition.handler(args, invocation);
            invocation.log("info", "site.result", {
              kind: "tool",
              name: definition.name,
              ...resultMetadata(result),
            });
            return result;
          },
        }),
      );
    }
    for (const definition of resourceDefinitions) {
      handles.push(
        app.resource({
          ...definition,
          handler: async (_request, invocation) => {
            const result = await definition.handler();
            invocation.log("info", "site.result", {
              kind: "resource",
              name: definition.name,
              ...resultMetadata(result),
            });
            return result;
          },
        }),
      );
    }
    for (const definition of promptDefinitions) {
      handles.push(
        app.prompt({
          ...definition,
          handler: async (args, invocation) => {
            const result = await definition.handler(args);
            invocation.log("info", "site.result", {
              kind: "prompt",
              name: definition.name,
              ...resultMetadata(result),
            });
            return result;
          },
        }),
      );
    }
  } catch (error) {
    for (const handle of handles.reverse()) void handle.unregister();
    throw error;
  }

  return {
    handles,
    names: {
      tools: toolDefinitions.map(({ name }) => name),
      resources: resourceDefinitions.map(({ uri }) => uri),
      prompts: promptDefinitions.map(({ name }) => name),
    },
    ready: Promise.all(handles.map((handle) => handle.ready)).then(() => undefined),
    unregister: async () => {
      await Promise.all([...handles].reverse().map(async (handle) => await handle.unregister()));
    },
  };
};

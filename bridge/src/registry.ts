import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";

import { type BridgeLimits, DEFAULT_LIMITS } from "./config.js";
import { BridgeError } from "./errors.js";

export type JsonObject = Record<string, unknown>;
export type RegistrationKind = "prompt" | "resource" | "tool";

export interface AppIdentity {
  readonly id: string;
  readonly name: string;
  readonly version: string;
}

export interface RuntimeIdentity {
  readonly id: string;
  readonly instanceId: string;
  readonly userAgent?: string;
}

export interface BrowserSession {
  readonly app: AppIdentity;
  readonly capabilities: readonly string[];
  readonly connectedAt: string;
  readonly connectionId: string;
  readonly origin: string;
  readonly protocolVersion: string;
  readonly runtime: RuntimeIdentity;
  readonly sessionId: string;
}

interface RegistrationBase {
  readonly description?: string;
  readonly id: string;
  readonly name: string;
  readonly title?: string;
}

export interface ToolRegistration extends RegistrationBase {
  readonly annotations?: JsonObject;
  readonly inputSchema: JsonObject;
  readonly kind: "tool";
  readonly outputSchema?: JsonObject;
}

export interface ResourceRegistration extends RegistrationBase {
  readonly annotations?: JsonObject;
  readonly kind: "resource";
  readonly mimeType?: string;
  readonly uri: string;
}

export interface PromptRegistration extends RegistrationBase {
  readonly annotations?: JsonObject;
  readonly arguments?: readonly {
    readonly description?: string;
    readonly name: string;
    readonly required?: boolean;
  }[];
  readonly kind: "prompt";
}

export type BrowserRegistration = PromptRegistration | ResourceRegistration | ToolRegistration;

export interface RegisteredCapability<T extends BrowserRegistration = BrowserRegistration> {
  readonly exposedName: string;
  readonly exposedUri?: string;
  readonly registration: T;
  readonly session: BrowserSession;
}

export interface RegistrySnapshot {
  readonly prompts: readonly RegisteredCapability<PromptRegistration>[];
  readonly resources: readonly RegisteredCapability<ResourceRegistration>[];
  readonly sessions: readonly BrowserSession[];
  readonly tools: readonly RegisteredCapability<ToolRegistration>[];
}

export interface RegistryUsage {
  readonly registrations: number;
  readonly retainedBytes: number;
}

type RegistrationLimits = Pick<
  BridgeLimits,
  | "maxRegistrationBytesPerRuntime"
  | "maxRegistrationBytesTotal"
  | "maxRegistrationsPerRuntime"
  | "maxRegistrationsTotal"
>;

function safeName(value: string, maxLength = 70): string {
  const normalized = value.normalize("NFKC").replace(/[^A-Za-z0-9_.-]+/g, "_");
  return (normalized.replace(/^[_.-]+|[_.-]+$/g, "") || "unnamed").slice(0, maxLength);
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function capabilityName(session: BrowserSession, registration: BrowserRegistration): string {
  return `${safeName(session.app.id, 20)}_${fingerprint(session.app.id)}_${fingerprint(session.origin)}__${safeName(registration.name, 70)}`;
}

function resourceUri(session: BrowserSession, registration: ResourceRegistration): string {
  const namespace = `app-${fingerprint(session.app.id)}-${fingerprint(session.origin)}`;
  return `browsermcp://${namespace}/${Buffer.from(registration.uri).toString("base64url")}`;
}

function registrationBytes(registration: BrowserRegistration): number {
  try {
    const serialized = JSON.stringify(registration);
    if (serialized === undefined) throw new Error("Registration is not JSON serializable");
    return Buffer.byteLength(serialized, "utf8");
  } catch {
    throw new BridgeError("INVALID_MESSAGE", "Registration must be JSON serializable");
  }
}

/**
 * The registry owns no browser transport. It keeps registrations scoped to a
 * connection and exposes stable, origin-separated MCP names.
 */
export class CapabilityRegistry extends EventEmitter {
  readonly #bytesByConnection = new Map<string, Map<string, number>>();
  readonly #limits: RegistrationLimits;
  readonly #registrations = new Map<string, Map<string, RegisteredCapability>>();
  readonly #sessions = new Map<string, BrowserSession>();
  #registrationCount = 0;
  #retainedBytes = 0;

  public constructor(limits: RegistrationLimits = DEFAULT_LIMITS) {
    super();
    this.#limits = limits;
  }

  public addSession(session: BrowserSession): void {
    for (const existing of this.#sessions.values()) {
      if (
        existing.origin === session.origin &&
        existing.app.id === session.app.id &&
        existing.runtime.instanceId === session.runtime.instanceId
      ) {
        throw new BridgeError(
          "REGISTRATION_CONFLICT",
          "This app runtime instance is already connected",
          { connectionId: existing.connectionId },
        );
      }
    }
    this.#sessions.set(session.connectionId, session);
    this.#registrations.set(session.connectionId, new Map());
    this.#bytesByConnection.set(session.connectionId, new Map());
    this.emit("sessionsChanged");
  }

  public removeSession(connectionId: string): readonly RegisteredCapability[] {
    const removed = [...(this.#registrations.get(connectionId)?.values() ?? [])];
    const retainedBytes = [...(this.#bytesByConnection.get(connectionId)?.values() ?? [])].reduce(
      (total, bytes) => total + bytes,
      0,
    );
    this.#registrationCount = Math.max(0, this.#registrationCount - removed.length);
    this.#retainedBytes = Math.max(0, this.#retainedBytes - retainedBytes);
    this.#bytesByConnection.delete(connectionId);
    this.#registrations.delete(connectionId);
    const hadSession = this.#sessions.delete(connectionId);
    if (removed.length > 0)
      this.emitChangedKinds(removed.map(({ registration }) => registration.kind));
    if (hadSession) this.emit("sessionsChanged");
    return removed;
  }

  public register(connectionId: string, registration: BrowserRegistration): RegisteredCapability {
    const session = this.#sessions.get(connectionId);
    const registrations = this.#registrations.get(connectionId);
    const bytesByRegistration = this.#bytesByConnection.get(connectionId);
    if (session === undefined || registrations === undefined || bytesByRegistration === undefined) {
      throw new BridgeError("BROWSER_DISCONNECTED", "Browser session is not connected");
    }
    if (registrations.has(registration.id)) {
      throw new BridgeError(
        "REGISTRATION_CONFLICT",
        `Registration id '${registration.id}' is already in use in this runtime`,
      );
    }
    const exposedName = capabilityName(session, registration);
    const existingLocalName = [...registrations.values()].find(
      (candidate) =>
        candidate.registration.kind === registration.kind && candidate.exposedName === exposedName,
    );
    if (existingLocalName) {
      throw new BridgeError(
        "REGISTRATION_CONFLICT",
        `Registration name collides with '${existingLocalName.registration.name}' after normalization`,
      );
    }
    const exposedUri =
      registration.kind === "resource" ? resourceUri(session, registration) : undefined;
    const existingLocalUri =
      exposedUri === undefined
        ? undefined
        : [...registrations.values()].find(
            (candidate) =>
              candidate.registration.kind === "resource" && candidate.exposedUri === exposedUri,
          );
    if (existingLocalUri) {
      throw new BridgeError(
        "REGISTRATION_CONFLICT",
        `Resource URI collides with '${existingLocalUri.registration.name}' in this runtime`,
      );
    }
    const retainedBytes = registrationBytes(registration);
    const runtimeBytes = [...bytesByRegistration.values()].reduce(
      (total, bytes) => total + bytes,
      0,
    );
    if (registrations.size >= this.#limits.maxRegistrationsPerRuntime) {
      throw new BridgeError("REGISTRATION_LIMIT", "Runtime registration count limit reached", {
        limit: this.#limits.maxRegistrationsPerRuntime,
      });
    }
    if (this.#registrationCount >= this.#limits.maxRegistrationsTotal) {
      throw new BridgeError("REGISTRATION_LIMIT", "Bridge registration count limit reached", {
        limit: this.#limits.maxRegistrationsTotal,
      });
    }
    if (runtimeBytes + retainedBytes > this.#limits.maxRegistrationBytesPerRuntime) {
      throw new BridgeError("REGISTRATION_LIMIT", "Runtime registration byte limit reached", {
        limitBytes: this.#limits.maxRegistrationBytesPerRuntime,
      });
    }
    if (this.#retainedBytes + retainedBytes > this.#limits.maxRegistrationBytesTotal) {
      throw new BridgeError("REGISTRATION_LIMIT", "Bridge registration byte limit reached", {
        limitBytes: this.#limits.maxRegistrationBytesTotal,
      });
    }
    const capability: RegisteredCapability = {
      exposedName,
      ...(exposedUri === undefined ? {} : { exposedUri }),
      registration,
      session,
    };
    registrations.set(registration.id, capability);
    bytesByRegistration.set(registration.id, retainedBytes);
    this.#registrationCount += 1;
    this.#retainedBytes += retainedBytes;
    this.emitChangedKinds([registration.kind]);
    return capability;
  }

  public unregister(connectionId: string, registrationId: string): RegisteredCapability {
    const registrations = this.#registrations.get(connectionId);
    const capability = registrations?.get(registrationId);
    if (capability === undefined) {
      throw new BridgeError("NOT_FOUND", `Unknown registration '${registrationId}'`);
    }
    const retainedBytes = this.#bytesByConnection.get(connectionId)?.get(registrationId) ?? 0;
    this.#bytesByConnection.get(connectionId)?.delete(registrationId);
    registrations?.delete(registrationId);
    this.#registrationCount = Math.max(0, this.#registrationCount - 1);
    this.#retainedBytes = Math.max(0, this.#retainedBytes - retainedBytes);
    this.emitChangedKinds([capability.registration.kind]);
    return capability;
  }

  public getRegistration(
    connectionId: string,
    registrationId: string,
  ): RegisteredCapability | undefined {
    return this.#registrations.get(connectionId)?.get(registrationId);
  }

  public providersByName(
    kind: "prompt" | "tool",
    exposedName: string,
  ): readonly RegisteredCapability[] {
    return this.all().filter(
      (capability) =>
        capability.registration.kind === kind && capability.exposedName === exposedName,
    );
  }

  public providersByUri(exposedUri: string): readonly RegisteredCapability<ResourceRegistration>[] {
    return this.all().filter(
      (capability): capability is RegisteredCapability<ResourceRegistration> =>
        capability.registration.kind === "resource" && capability.exposedUri === exposedUri,
    );
  }

  public resolveUnique<T extends RegisteredCapability>(providers: readonly T[], target: string): T {
    if (providers.length === 0) {
      throw new BridgeError("NOT_FOUND", `No connected browser provides '${target}'`);
    }
    if (providers.length > 1) {
      throw new BridgeError(
        "AMBIGUOUS_TARGET",
        `'${target}' is provided by multiple tabs; close duplicates and retry`,
        {
          runtimes: providers.map(({ session }) => ({
            appId: session.app.id,
            instanceId: session.runtime.instanceId,
            runtimeId: session.runtime.id,
          })),
        },
      );
    }
    const provider = providers[0];
    if (provider === undefined) throw new BridgeError("NOT_FOUND", `No provider for '${target}'`);
    return provider;
  }

  public snapshot(): RegistrySnapshot {
    const all = this.all();
    return {
      sessions: [...this.#sessions.values()],
      tools: all.filter(
        (item): item is RegisteredCapability<ToolRegistration> => item.registration.kind === "tool",
      ),
      resources: all.filter(
        (item): item is RegisteredCapability<ResourceRegistration> =>
          item.registration.kind === "resource",
      ),
      prompts: all.filter(
        (item): item is RegisteredCapability<PromptRegistration> =>
          item.registration.kind === "prompt",
      ),
    };
  }

  public get usage(): RegistryUsage {
    return { registrations: this.#registrationCount, retainedBytes: this.#retainedBytes };
  }

  private all(): RegisteredCapability[] {
    return [...this.#registrations.values()].flatMap((registrations) => [
      ...registrations.values(),
    ]);
  }

  private emitChangedKinds(kinds: readonly RegistrationKind[]): void {
    for (const kind of new Set(kinds)) this.emit(`${kind}sChanged`);
  }
}

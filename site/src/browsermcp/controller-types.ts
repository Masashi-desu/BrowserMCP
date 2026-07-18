import type { ConnectionDiagnostic } from "../runtime/bridge-config.js";

export interface ConnectionViewModel {
  readonly bridgeUrl: string;
  readonly connectionState: string;
  readonly approval?: {
    readonly requestId: string;
    readonly origin: string;
    readonly expiresAt: number;
  };
  readonly sessionState: "none" | "active" | "resume-available";
  readonly sessionId?: string;
  readonly registrations: readonly {
    readonly kind: string;
    readonly name: string;
    readonly status: string;
  }[];
  readonly recentExecutions: readonly {
    readonly name: string;
    readonly kind: string;
    readonly status: string;
    readonly durationMs?: number;
    readonly startedAt?: number;
    readonly error?: string;
  }[];
  readonly lastResult?: string;
  readonly lastError?: { readonly code: string; readonly message: string };
  readonly logs: readonly {
    readonly timestamp: number;
    readonly level: string;
    readonly event: string;
  }[];
  readonly health: "unchecked" | "checking" | "reachable" | "failed";
  readonly healthMessage?: string;
  readonly diagnostics: readonly ConnectionDiagnostic[];
}

export interface SiteConnectionController {
  getViewModel(): ConnectionViewModel;
  subscribe(listener: (model: ConnectionViewModel) => void): () => void;
  connect(bridgeUrl: string): Promise<void>;
  reconnect(): Promise<void>;
  disconnect(): Promise<void>;
  checkHealth(bridgeUrl: string): Promise<void>;
  destroy(): Promise<void>;
}

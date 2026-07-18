import { safeText } from "./logger.js";

export type RequestOutcome = "cancelled" | "error" | "pending" | "success" | "timeout";

export interface RecentRequest {
  readonly appId: string;
  readonly completedAt?: string;
  readonly durationMs?: number;
  readonly error?: { readonly code: string; readonly message: string };
  readonly invocationId: string;
  readonly kind: string;
  readonly outcome: RequestOutcome;
  readonly registrationId: string;
  readonly result?: {
    readonly isError?: boolean;
    readonly itemCount: number;
    readonly kind: string;
  };
  readonly startedAt: string;
}

export class RecentRequestStore {
  readonly #limit: number;
  readonly #requests = new Map<string, RecentRequest>();
  readonly #order: string[] = [];

  public constructor(limit = 100) {
    this.#limit = limit;
  }

  public start(request: Omit<RecentRequest, "outcome" | "startedAt">): void {
    const item: RecentRequest = {
      ...request,
      outcome: "pending",
      startedAt: new Date().toISOString(),
    };
    this.#requests.set(request.invocationId, item);
    this.#order.push(request.invocationId);
    while (this.#order.length > this.#limit) {
      const oldest = this.#order.shift();
      if (oldest) this.#requests.delete(oldest);
    }
  }

  public finish(
    invocationId: string,
    outcome: Exclude<RequestOutcome, "pending">,
    error?: { readonly code: string; readonly message: string },
    result?: RecentRequest["result"],
  ): void {
    const current = this.#requests.get(invocationId);
    if (current?.outcome !== "pending") return;
    const completedAt = new Date();
    this.#requests.set(invocationId, {
      ...current,
      completedAt: completedAt.toISOString(),
      durationMs: Math.max(0, completedAt.getTime() - Date.parse(current.startedAt)),
      outcome,
      ...(error
        ? { error: { code: safeText(error.code, 64), message: safeText(error.message) } }
        : {}),
      ...(result ? { result } : {}),
    });
  }

  public recent(): readonly RecentRequest[] {
    return this.#order
      .slice()
      .reverse()
      .flatMap((id) => {
        const item = this.#requests.get(id);
        return item ? [item] : [];
      });
  }
}

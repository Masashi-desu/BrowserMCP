import type { TextAnalysis } from "./worker-logic.js";

export const analyzeInWorker = async (
  text: string,
  signal?: AbortSignal,
): Promise<TextAnalysis> => {
  if (signal?.aborted === true) {
    throw new DOMException("Worker analysis cancelled.", "AbortError");
  }
  const worker = new Worker(new URL("./text-worker.ts", import.meta.url), { type: "module" });
  const id = crypto.randomUUID();
  return await new Promise<TextAnalysis>((resolve, reject) => {
    const cleanup = (): void => {
      worker.terminate();
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = (): void => {
      cleanup();
      reject(new DOMException("Worker analysis cancelled.", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.addEventListener(
      "message",
      (event: MessageEvent<{ id: string; ok: boolean; result?: TextAnalysis; error?: string }>) => {
        if (event.data.id !== id) return;
        cleanup();
        if (event.data.ok && event.data.result !== undefined) resolve(event.data.result);
        else reject(new Error(event.data.error ?? "Worker analysis failed."));
      },
      { once: true },
    );
    worker.addEventListener(
      "error",
      () => {
        cleanup();
        reject(new Error("Worker could not be started."));
      },
      { once: true },
    );
    worker.postMessage({ id, text });
  });
};

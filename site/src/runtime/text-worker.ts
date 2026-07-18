import { analyzeText } from "./worker-logic.js";

interface WorkerRequest {
  readonly id: string;
  readonly text: string;
}

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  try {
    const result = analyzeText(event.data.text);
    self.postMessage({ id: event.data.id, ok: true, result });
  } catch (error) {
    self.postMessage({
      id: event.data.id,
      ok: false,
      error: error instanceof Error ? error.message : "Worker analysis failed.",
    });
  }
});

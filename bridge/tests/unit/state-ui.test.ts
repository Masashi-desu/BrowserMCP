import { describe, expect, it } from "vitest";

import { renderStateUi } from "../../src/state-ui.js";

function inlineScript(html: string): string {
  const match = /<script nonce="[^"]+">([\s\S]*)<\/script>/u.exec(html);
  if (match?.[1] === undefined) throw new Error("Rendered state UI has no inline script");
  return match[1];
}

describe("Bridge state UI", () => {
  it("renders parseable authenticated and login scripts", () => {
    const authenticated = renderStateUi("test-nonce", true, "test-csrf");
    const login = renderStateUi("test-nonce", false);

    expect(() => new Function(inlineScript(authenticated))).not.toThrow();
    expect(() => new Function(inlineScript(login))).not.toThrow();
    expect(authenticated).toContain("Pending Origin approvals");
    expect(authenticated).toContain('data-decision="approve"');
    expect(authenticated).toContain("Legacy one-time token pairing");
  });
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const workflowPath = fileURLToPath(new URL("../../.github/workflows/pages.yml", import.meta.url));

describe("GitHub Pages deployment workflow", () => {
  it("gates main deployments and uploads only the generated static site", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("branches: [main]");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("pull_request:");
    expect(workflow.indexOf("run: npm run check")).toBeLessThan(
      workflow.indexOf("name: Upload GitHub Pages artifact"),
    );
    expect(workflow).toContain("VITE_BASE_PATH: $" + "{{ steps.pages.outputs.base_path }}/");
    expect(workflow).toContain("path: site/dist");
    expect(workflow).not.toContain("path: .\n");
  });

  it("pins external actions and keeps deployment authority in the deploy job", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const actionReferences = [...workflow.matchAll(/uses: ([^\s#]+)/g)].map(
      ([, reference]) => reference ?? "",
    );

    expect(actionReferences).toHaveLength(5);
    for (const reference of actionReferences) {
      expect(reference).toMatch(/^actions\/[a-z-]+@[0-9a-f]{40}$/);
    }
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).toContain("    permissions:\n      pages: write\n      id-token: write");
    expect(workflow).not.toContain("secrets.");
    expect(workflow).not.toContain("persist-credentials: true");
  });
});

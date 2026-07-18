import { describe, expect, it } from "vitest";
import { docs, requiredDocPageIds } from "../src/docs/content.js";
import {
  docsStatus,
  docsIndex,
  findExamples,
  getCapabilities,
  getPage,
  getRelated,
  getResponsibilities,
  getSection,
  searchApi,
  searchDocs,
  searchTypes,
} from "../src/docs/engine.js";

describe("structured documentation corpus", () => {
  it("contains every required documentation region exactly once", () => {
    expect(docs).toHaveLength(19);
    expect(docs.map(({ id }) => id)).toEqual([...requiredDocPageIds]);
    expect(new Set(docs.map(({ path }) => path)).size).toBe(19);
    expect(docsStatus.sections).toBeGreaterThanOrEqual(60);
  });

  it("keeps stable page and section identifiers with source metadata", () => {
    for (const page of docs) {
      expect(page.source.length).toBeGreaterThan(2);
      expect(new Set(page.sections.map(({ id }) => id)).size).toBe(page.sections.length);
      for (const section of page.sections) {
        expect(section.summary.length).toBeGreaterThan(20);
        expect(section.content.length).toBeGreaterThan(0);
        expect(section.source ?? page.source).not.toBe("");
      }
    }
  });

  it("returns traceable cross-document search results", () => {
    const results = searchDocs("pairing connection authentication Origin", { limit: 15 });
    expect(new Set(results.map(({ pageId }) => pageId)).size).toBeGreaterThan(2);
    expect(results.every(({ path, source }) => path.includes("#") && source.length > 0)).toBe(true);
    expect(
      results.every(
        ({ path, logicalPath, href }) =>
          logicalPath === path && href === `#${logicalPath}` && href.startsWith("#/docs/"),
      ),
    ).toBe(true);
  });

  it("provides base-independent hash links for index, page, section, and related results", () => {
    const indexPage = docsIndex.find(({ id }) => id === "tools");
    expect(indexPage).toMatchObject({
      logicalPath: "/docs/tools",
      href: "#/docs/tools",
    });
    expect(indexPage?.sections.find(({ id }) => id === "register-tool")).toMatchObject({
      logicalPath: "/docs/tools#register-tool",
      href: "#/docs/tools#register-tool",
    });

    const page = getPage("tools");
    const section = getSection("tools", "register-tool");
    const related = getRelated("tools", "register-tool");
    expect(page.ok && page.data.href).toBe("#/docs/tools");
    expect(section.ok && section.data.section.href).toBe("#/docs/tools#register-tool");
    expect(related.ok && related.data.every(({ href }) => href.startsWith("#/docs/"))).toBe(true);
  });

  it("supports API, type, and example lookup independently", () => {
    expect(searchApi("register tool").some(({ sectionId }) => sectionId === "register-tool")).toBe(
      true,
    );
    expect(searchTypes("ConnectOptions").some(({ pageId }) => pageId === "api-reference")).toBe(
      true,
    );
    expect(
      findExamples("tool registration").flatMap(({ examples }) => examples).length,
    ).toBeGreaterThan(0);
  });

  it("returns exact page, section, related pages, and responsibilities", () => {
    const page = getPage("tools");
    const section = getSection("tools", "register-tool");
    const related = getRelated("tools", "register-tool");
    expect(page.ok && page.data.id).toBe("tools");
    expect(section.ok && section.data.section.id).toBe("register-tool");
    expect(related.ok && related.data.length).toBeGreaterThan(0);
    expect(
      getResponsibilities("document search").some(
        ({ sectionId }) => sectionId === "responsibility-boundaries",
      ),
    ).toBe(true);
  });

  it("distinguishes implemented, planned, and constrained behavior", () => {
    const status = getCapabilities();
    expect(status.implemented.length).toBeGreaterThan(0);
    expect(status.partial.length).toBeGreaterThan(0);
    expect(status.planned.length).toBeGreaterThan(0);
    expect(status.constraints.length).toBeGreaterThan(0);
    expect(status.planned.every(({ status }) => status === "planned")).toBe(true);
  });
});

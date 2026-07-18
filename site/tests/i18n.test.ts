import { describe, expect, it } from "vitest";
import { docs } from "../src/docs/content.js";
import { searchDocs } from "../src/docs/engine.js";
import { localizedDocPage, missingLocalizedDocKeys } from "../src/i18n/docs-content.js";
import { localizedDocPageTitle, localizedDocSectionTitle } from "../src/i18n/docs.js";
import {
  createTranslator,
  isSupportedLocale,
  loadLocale,
  localeDefinitions,
  localeStorageKey,
  missingTranslationKeys,
  resolveLocale,
  saveLocale,
  SUPPORTED_LOCALES,
} from "../src/i18n/index.js";
import { parseRoute, routeSnapshot } from "../src/ui/router.js";

describe("site internationalization", () => {
  it("publishes unique metadata for every supported locale", () => {
    expect(SUPPORTED_LOCALES).toHaveLength(9);
    expect(new Set(SUPPORTED_LOCALES).size).toBe(SUPPORTED_LOCALES.length);
    expect(localeDefinitions.map(({ locale }) => locale)).toEqual(SUPPORTED_LOCALES);
    expect(localeDefinitions.find(({ locale }) => locale === "ar")?.direction).toBe("rtl");
  });

  it("resolves exact, regional, and primary language preferences deterministically", () => {
    expect(resolveLocale(["ja-JP", "en-US"])).toBe("ja");
    expect(resolveLocale(["zh-Hans-SG"])).toBe("zh-CN");
    expect(resolveLocale(["pt-PT"])).toBe("pt-BR");
    expect(resolveLocale(["xx-ZZ", "ru-RU"])).toBe("ru");
    expect(resolveLocale(["xx-ZZ"])).toBe("en");
    expect(isSupportedLocale("ar")).toBe(true);
    expect(isSupportedLocale("zh-TW")).toBe(false);
  });

  it("uses an allowlisted stored preference and degrades safely when storage fails", () => {
    expect(loadLocale({ getItem: () => "ja" }, ["en-US"])).toBe("ja");
    expect(loadLocale({ getItem: () => "not-a-locale" }, ["es-MX"])).toBe("es");
    expect(
      loadLocale(
        {
          getItem: () => {
            throw new Error("denied");
          },
        },
        ["fr-FR"],
      ),
    ).toBe("en");
    expect(() =>
      saveLocale("ar", {
        setItem: () => {
          throw new Error("denied");
        },
      }),
    ).not.toThrow();

    let stored: readonly string[] = [];
    saveLocale("ru", {
      setItem: (key, value) => {
        stored = [key, value];
      },
    });
    expect(stored).toEqual([localeStorageKey, "ru"]);
  });

  it("translates Japanese UI, interpolates values, and falls back to source text", () => {
    const japanese = createTranslator("ja");
    expect(japanese.t("landing.heroBefore")).toBe("ブラウザが ");
    expect(japanese.t("landing.exploreDocs", { count: 19 })).toContain("19件");
    expect(japanese.t("connection.disconnect")).toBe("切断");

    const spanish = createTranslator("es");
    expect(spanish.t("common.overview")).toBe("Resumen");
    expect(spanish.t("landing.featureBackendTitle")).toBe("Sin backend duplicado");
    expect(createTranslator("ar").direction).toBe("rtl");
  });

  it("localizes stable documentation titles without changing identifiers", () => {
    expect(localizedDocPageTitle("ja", "security-model", "Security Model")).toBe(
      "セキュリティモデル",
    );
    expect(localizedDocSectionTitle("ja", "tools", "register-tool", "Register a tool")).toBe(
      "Toolを登録",
    );
    expect(localizedDocPageTitle("es", "security-model", "Security Model")).toBe(
      "Modelo de seguridad",
    );

    const snapshot = routeSnapshot(
      parseRoute("#/docs/tools#register-tool"),
      createTranslator("ja"),
    );
    expect(snapshot).toMatchObject({
      title: "Tool",
      path: "/docs/tools",
      docPageId: "tools",
      hash: "register-tool",
      locale: "ja",
      direction: "ltr",
    });
  });

  it.each([
    "接続 認証",
    "连接 认证",
    "conexión autenticación",
    "कनेक्शन प्रमाणीकरण",
    "اتصال مصادقة",
    "conexão autenticação",
    "সংযোগ প্রমাণীকরণ",
    "подключение аутентификация",
  ])("maps localized search terms into the source-backed index: %s", (query) => {
    expect(searchDocs(query, { limit: 5 }).length).toBeGreaterThan(0);
  });

  it("has no English fallback keys in any advertised non-English locale", () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(missingTranslationKeys(locale), locale).toEqual([]);
    }
  });

  it("has translated technical prose for every non-English locale and preserves canonical code", () => {
    for (const locale of SUPPORTED_LOCALES.filter((value) => value !== "en")) {
      expect(missingLocalizedDocKeys(locale, docs), locale).toEqual([]);
      for (const page of docs) {
        const localized = localizedDocPage(locale, page, page.title);
        expect(localized.description, `${locale}:${page.id}`).not.toBe(page.description);
        for (const section of page.sections) {
          expect(
            localized.sections[section.id]?.body,
            `${locale}:${page.id}/${section.id}`,
          ).not.toBe(section.content.join("\n\n"));
        }
      }
    }

    const source = docs.find(({ id }) => id === "creating-app");
    expect(source).toBeDefined();
    if (source === undefined) return;
    const localized = localizedDocPage("ja", source, "BrowserMCPアプリの作成");
    expect(localized.description).not.toBe(source.description);
    expect(localized.sections["minimal-app"]?.body).not.toContain(
      "Install @browsermcp/web in a bundler project",
    );
    expect(source.sections[0]?.examples?.[0]?.code).toContain(
      'import { BrowserMCP } from "@browsermcp/web"',
    );
  });
});

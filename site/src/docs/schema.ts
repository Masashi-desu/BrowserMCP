export const IMPLEMENTATION_STATUSES = ["implemented", "partial", "planned", "constraint"] as const;

export type ImplementationStatus = (typeof IMPLEMENTATION_STATUSES)[number];

export const SECTION_KINDS = [
  "concept",
  "architecture",
  "guide",
  "api",
  "type",
  "configuration",
  "protocol",
  "security",
  "troubleshooting",
  "example",
  "status",
] as const;

export type SectionKind = (typeof SECTION_KINDS)[number];

export interface CodeExample {
  readonly id: string;
  readonly title: string;
  readonly language: "typescript" | "json" | "shell" | "text";
  readonly code: string;
  readonly explanation: string;
}

export interface DocSection {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly content: readonly string[];
  readonly kind: SectionKind;
  readonly status: ImplementationStatus;
  readonly tags: readonly string[];
  readonly examples?: readonly CodeExample[];
  readonly related?: readonly string[];
  readonly source?: string;
}

export interface DocPage {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly path: `/docs/${string}`;
  readonly order: number;
  readonly audience: readonly ("app-developer" | "bridge-operator" | "contributor")[];
  readonly status: ImplementationStatus;
  readonly sections: readonly DocSection[];
  readonly related: readonly string[];
  readonly source: string;
}

export interface SearchOptions {
  readonly kinds?: readonly SectionKind[];
  readonly statuses?: readonly ImplementationStatus[];
  readonly pageIds?: readonly string[];
  readonly limit?: number;
}

export interface SearchResult {
  readonly pageId: string;
  readonly pageTitle: string;
  readonly sectionId: string;
  readonly heading: string;
  readonly summary: string;
  readonly excerpt: string;
  readonly path: string;
  /** Stable documentation identifier; it is not a deploy-root-relative browser URL. */
  readonly logicalPath: string;
  /** Base-independent hash-router link that works under repository Pages subpaths. */
  readonly href: string;
  readonly status: ImplementationStatus;
  readonly kind: SectionKind;
  readonly score: number;
  readonly matchedTerms: readonly string[];
  readonly related: readonly RelatedDocument[];
  readonly source: string;
  readonly examples: readonly CodeExample[];
}

export interface RelatedDocument {
  readonly pageId: string;
  readonly title: string;
  readonly path: string;
  readonly logicalPath: string;
  readonly href: string;
  readonly reason: string;
  readonly status: ImplementationStatus;
}

export type NavigableDocSection = DocSection & {
  readonly logicalPath: string;
  readonly href: string;
};

export type NavigableDocPage = Omit<DocPage, "sections"> & {
  readonly logicalPath: string;
  readonly href: string;
  readonly sections: readonly NavigableDocSection[];
};

export interface DocsAnswer<T> {
  readonly ok: true;
  readonly data: T;
  readonly source: {
    readonly corpus: "browsermcp-site-docs";
    readonly version: string;
    readonly generatedFrom: "structured-docs";
  };
}

export interface DocsError {
  readonly ok: false;
  readonly error: {
    readonly code: "INVALID_INPUT" | "NOT_FOUND" | "UNSUPPORTED";
    readonly message: string;
    readonly suggestions: readonly RelatedDocument[];
  };
}

export type DocsResult<T> = DocsAnswer<T> | DocsError;

export interface CapabilitySummary {
  readonly implemented: readonly SearchResult[];
  readonly partial: readonly SearchResult[];
  readonly planned: readonly SearchResult[];
  readonly constraints: readonly SearchResult[];
}

export interface ImplementationGuide {
  readonly goal: string;
  readonly environment: string;
  readonly steps: readonly SearchResult[];
  readonly prerequisites: readonly SearchResult[];
  readonly cautions: readonly SearchResult[];
  readonly next: readonly RelatedDocument[];
}

export interface TroubleshootingReport {
  readonly problem: string;
  readonly likelyCauses: readonly SearchResult[];
  readonly checks: readonly SearchResult[];
  readonly remediation: readonly SearchResult[];
  readonly next: readonly RelatedDocument[];
}

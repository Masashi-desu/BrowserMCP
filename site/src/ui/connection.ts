import type {
  ConnectionViewModel,
  SiteConnectionController,
} from "../browsermcp/controller-types.js";
import type { MessageKey, Translator } from "../i18n/index.js";
import { badge, button, element, link } from "./dom.js";
import { routeHref } from "./router.js";

export interface ConnectionDraft {
  bridgeUrl: string;
  bridgeDirty: boolean;
}

export const createConnectionDraft = (bridgeUrl: string): ConnectionDraft => ({
  bridgeUrl,
  bridgeDirty: false,
});

export const reconcileConnectionDraft = (
  draft: ConnectionDraft,
  modelBridgeUrl: string,
): ConnectionDraft => {
  if (!draft.bridgeDirty) draft.bridgeUrl = modelBridgeUrl;
  return draft;
};

export const latestConnectionLogs = (
  logs: ConnectionViewModel["logs"],
): ConnectionViewModel["logs"] => logs.slice(0, 10);

const stateVariant = (state: string): string => {
  if (state === "connected") return "implemented";
  if (state === "error") return "constraint";
  if (state === "connecting" || state === "awaiting-approval" || state === "reconnecting")
    return "partial";
  return "neutral";
};

const statusCard = (label: string, value: string, detail: string): HTMLElement =>
  element("article", { className: "status-card" }, [
    element("span", { className: "status-card__label" }, [label]),
    element("strong", {}, [value]),
    element("small", {}, [detail]),
  ]);

const valueKeys: Readonly<Record<string, MessageKey>> = {
  idle: "common.idle",
  connected: "common.connected",
  connecting: "common.connecting",
  "awaiting-approval": "common.awaitingApproval",
  reconnecting: "common.reconnecting",
  disconnected: "common.disconnected",
  error: "common.error",
  registered: "common.registered",
  pending: "common.pending",
  success: "common.success",
  running: "common.running",
  failed: "common.failed",
  none: "common.none",
  active: "common.active",
  "resume-available": "common.resumeAvailable",
  unchecked: "common.unchecked",
  checking: "common.checking",
  reachable: "common.reachable",
  ready: "common.ready",
  check: "common.check",
  blocked: "common.blocked",
};

const localizedValue = (translator: Translator, value: string): string => {
  const key = valueKeys[value];
  return key === undefined ? value : translator.t(key);
};

const localizedDiagnostic = (
  diagnostic: ConnectionViewModel["diagnostics"][number],
  bridgeUrl: string,
  translator: Translator,
): { readonly title: string; readonly detail: string; readonly action?: string } => {
  let bridge: URL;
  try {
    bridge = new URL(bridgeUrl);
  } catch {
    return {
      title: translator.t("connection.diagnosticTransport"),
      detail: diagnostic.detail,
      ...(diagnostic.action === undefined ? {} : { action: diagnostic.action }),
    };
  }
  switch (diagnostic.id) {
    case "transport":
      return diagnostic.level === "blocked"
        ? {
            title: translator.t("connection.diagnosticTransport"),
            detail: diagnostic.detail,
            ...(diagnostic.action === undefined ? {} : { action: diagnostic.action }),
          }
        : {
            title: translator.t("connection.diagnosticTransport"),
            detail: translator.t("connection.diagnosticTransportReady", {
              endpoint: `${bridge.protocol}//${bridge.host}`,
            }),
          };
    case "certificate":
      return bridge.protocol === "wss:"
        ? {
            title: translator.t("connection.diagnosticCertificate"),
            detail: translator.t("connection.diagnosticCertificateSecure"),
            action: translator.t("connection.diagnosticCertificateAction", {
              host: bridge.host,
            }),
          }
        : {
            title: translator.t("connection.diagnosticCertificate"),
            detail: translator.t("connection.diagnosticCertificateDevelopment"),
          };
    case "origin":
      return {
        title: translator.t("connection.diagnosticOrigin"),
        detail: translator.t("connection.diagnosticOriginDetail", {
          origin: location.origin,
        }),
        action: translator.t("connection.diagnosticOriginAction"),
      };
    case "local-network":
      return {
        title: translator.t("connection.diagnosticNetwork"),
        detail: translator.t("connection.diagnosticNetworkDetail"),
        action: translator.t("connection.diagnosticNetworkAction"),
      };
  }
};

const registrationList = (model: ConnectionViewModel, translator: Translator): HTMLElement => {
  const groups = ["tool", "resource", "prompt"].map((kind) => ({
    kind,
    values: model.registrations.filter((registration) => registration.kind === kind),
  }));
  return element(
    "div",
    { className: "registration-groups" },
    groups.map(({ kind, values }) =>
      element("section", { className: "registration-group" }, [
        element("div", { className: "registration-group__header" }, [
          element("h3", {}, [
            translator.t(
              kind === "tool"
                ? "connection.tools"
                : kind === "resource"
                  ? "connection.resources"
                  : "connection.prompts",
            ),
          ]),
          element("span", {}, [String(values.length)]),
        ]),
        values.length === 0
          ? element("p", { className: "empty-state" }, [translator.t("connection.noRegistrations")])
          : element(
              "ul",
              {},
              values.map((registration) =>
                element("li", {}, [
                  element("span", {}, [registration.name]),
                  badge(
                    localizedValue(translator, registration.status),
                    registration.status === "registered" ? "implemented" : "partial",
                  ),
                ]),
              ),
            ),
      ]),
    ),
  );
};

const executionHistory = (model: ConnectionViewModel, translator: Translator): HTMLElement =>
  element("div", { className: "history-list" }, [
    ...(model.recentExecutions.length === 0
      ? [element("p", { className: "empty-state" }, [translator.t("connection.noExecutions")])]
      : model.recentExecutions.map((execution) =>
          element("article", { className: "history-item" }, [
            element("div", {}, [
              element("strong", {}, [execution.name]),
              element("small", {}, [execution.kind]),
            ]),
            element("div", { className: "history-item__outcome" }, [
              badge(
                localizedValue(translator, execution.status),
                execution.status === "success"
                  ? "implemented"
                  : execution.status === "running"
                    ? "partial"
                    : "constraint",
              ),
              execution.durationMs === undefined
                ? false
                : element("span", {}, [`${execution.durationMs} ms`]),
            ]),
            execution.error === undefined ? false : element("p", {}, [execution.error]),
          ]),
        )),
  ]);

export const renderConnection = (
  model: ConnectionViewModel,
  controller: SiteConnectionController,
  draft: ConnectionDraft,
  translator: Translator,
): HTMLElement => {
  reconcileConnectionDraft(draft, model.bridgeUrl);
  const main = element("main", { id: "main-content", className: "connection-page" });
  const urlInput = element("input", {
    id: "bridge-url",
    ariaLabel: translator.t("connection.bridgeUrl"),
  });
  urlInput.type = "url";
  urlInput.maxLength = 2_048;
  urlInput.value = draft.bridgeUrl;
  urlInput.autocomplete = "off";
  urlInput.spellcheck = false;
  urlInput.addEventListener("input", () => {
    draft.bridgeUrl = urlInput.value;
    draft.bridgeDirty = true;
  });
  const connect = button(
    translator.t("connection.connect"),
    () => {
      const url = urlInput.value.trim();
      draft.bridgeUrl = url;
      draft.bridgeDirty = false;
      void controller.connect(url);
    },
    "button button--primary",
  );
  connect.disabled = ["connecting", "awaiting-approval", "reconnecting", "connected"].includes(
    model.connectionState,
  );
  const health = button(
    translator.t("connection.checkAccess"),
    () => {
      void controller.checkHealth(urlInput.value.trim()).catch(() => undefined);
    },
    "button button--secondary",
  );
  const reconnect = button(
    translator.t("connection.reconnect"),
    () => void controller.reconnect(),
    "button button--secondary",
  );
  const disconnect = button(
    translator.t("connection.disconnect"),
    () => void controller.disconnect(),
    "button button--quiet",
  );

  main.append(
    element("header", { className: "connection-hero" }, [
      element("div", {}, [
        element("p", { className: "kicker" }, [translator.t("connection.siteRuntime")]),
        element("h1", {}, [translator.t("connection.title")]),
        element("p", {}, [translator.t("connection.lede")]),
      ]),
      badge(localizedValue(translator, model.connectionState), stateVariant(model.connectionState)),
    ]),
    element("section", { className: "connection-overview" }, [
      statusCard(
        translator.t("connection.transport"),
        localizedValue(translator, model.connectionState),
        model.bridgeUrl,
      ),
      statusCard(
        translator.t("connection.session"),
        localizedValue(translator, model.sessionState),
        model.sessionId === undefined
          ? translator.t("connection.noSession")
          : `…${model.sessionId.slice(-8)}`,
      ),
      statusCard(
        translator.t("connection.registrations"),
        translator.number(model.registrations.length),
        translator.t("connection.capabilityKinds"),
      ),
      statusCard(
        translator.t("connection.localAccess"),
        localizedValue(translator, model.health),
        model.healthMessage ?? translator.t("connection.healthHint"),
      ),
    ]),
    element("section", { className: "connection-panel" }, [
      element("div", { className: "connection-panel__copy" }, [
        element("p", { className: "kicker" }, [translator.t("connection.explicitPairing")]),
        element("h2", {}, [translator.t("connection.connectTitle")]),
        element("p", {}, [translator.t("connection.connectText")]),
      ]),
      element("form", { className: "connection-form" }, [
        element("label", {}, [translator.t("connection.bridgeUrl"), urlInput]),
        element("div", { className: "connection-form__actions" }, [
          connect,
          health,
          reconnect,
          disconnect,
        ]),
        element("p", { className: "form-note" }, [translator.t("connection.tokenNote")]),
      ]),
    ]),
    ...(model.approval === undefined
      ? []
      : [
          element("section", { className: "alert" }, [
            element("strong", {}, [translator.t("common.awaitingApproval")]),
            element("p", {}, [translator.t("connection.approvalPending")]),
            element("small", {}, [
              `${model.approval.origin} · …${model.approval.requestId.slice(-8)} · ${translator.time(model.approval.expiresAt)}`,
            ]),
          ]),
        ]),
    element("section", { className: "diagnostics" }, [
      element("div", { className: "section-heading section-heading--split" }, [
        element("div", {}, [
          element("p", { className: "kicker" }, [translator.t("connection.readiness")]),
          element("h2", {}, [translator.t("connection.fourChecks")]),
        ]),
        link(
          translator.t("connection.troubleshooting"),
          routeHref("/docs/troubleshooting"),
          "text-link",
        ),
      ]),
      element(
        "div",
        { className: "diagnostic-grid" },
        model.diagnostics.map((diagnostic) => {
          const display = localizedDiagnostic(diagnostic, model.bridgeUrl, translator);
          return element("article", { className: `diagnostic diagnostic--${diagnostic.level}` }, [
            element("div", { className: "diagnostic__heading" }, [
              element("h3", {}, [display.title]),
              badge(
                localizedValue(translator, diagnostic.level),
                diagnostic.level === "ready"
                  ? "implemented"
                  : diagnostic.level === "blocked"
                    ? "constraint"
                    : "partial",
              ),
            ]),
            element("p", {}, [display.detail]),
            display.action === undefined ? false : element("small", {}, [display.action]),
          ]);
        }),
      ),
    ]),
  );

  if (model.lastError !== undefined) {
    main.append(
      element(
        "section",
        {
          className: "alert alert--error",
          ariaLabel: translator.t("connection.recentError"),
        },
        [
          element("strong", {}, [model.lastError.code]),
          element("p", {}, [model.lastError.message]),
          link(
            translator.t("connection.diagnosticOrder"),
            routeHref("/docs/troubleshooting", "diagnostic-order"),
            "text-link",
          ),
        ],
      ),
    );
  }

  main.append(
    element("section", { className: "connection-data" }, [
      element("div", { className: "section-heading" }, [
        element("p", { className: "kicker" }, [translator.t("connection.liveSnapshot")]),
        element("h2", {}, [translator.t("connection.registeredHere")]),
      ]),
      registrationList(model, translator),
    ]),
    element("section", { className: "connection-data connection-data--split" }, [
      element("div", {}, [
        element("div", { className: "section-heading" }, [
          element("p", { className: "kicker" }, [translator.t("connection.requests")]),
          element("h2", {}, [translator.t("connection.recentExecutions")]),
        ]),
        executionHistory(model, translator),
      ]),
      element("div", {}, [
        element("div", { className: "section-heading" }, [
          element("p", { className: "kicker" }, [translator.t("connection.outcome")]),
          element("h2", {}, [translator.t("connection.latest")]),
        ]),
        element("pre", { className: "result-panel" }, [
          model.lastResult ?? translator.t("connection.noResult"),
        ]),
        element(
          "ol",
          { className: "log-list" },
          model.logs.length === 0
            ? [element("li", {}, [translator.t("connection.noEvents")])]
            : latestConnectionLogs(model.logs).map((entry) =>
                element("li", {}, [
                  element("time", {}, [translator.time(entry.timestamp)]),
                  element("span", {}, [entry.level]),
                  element("strong", {}, [entry.event]),
                ]),
              ),
        ),
      ]),
    ]),
  );
  return main;
};

import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import typescript from "highlight.js/lib/languages/typescript";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("json", json);
hljs.registerLanguage("typescript", typescript);

const copyText = async (value: string): Promise<void> => {
  if (navigator.clipboard?.writeText !== undefined) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const fallback = document.createElement("textarea");
  fallback.value = value;
  fallback.style.position = "fixed";
  fallback.style.opacity = "0";
  document.body.append(fallback);
  try {
    fallback.select();
    if (!document.execCommand("copy")) throw new Error("Clipboard copy is unavailable.");
  } finally {
    fallback.remove();
  }
};

export type Child = Node | string | number | false | null | undefined;

export const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: {
    readonly className?: string;
    readonly id?: string;
    readonly title?: string;
    readonly ariaLabel?: string;
  } = {},
  children: readonly Child[] = [],
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (options.className !== undefined) node.className = options.className;
  if (options.id !== undefined) node.id = options.id;
  if (options.title !== undefined) node.title = options.title;
  if (options.ariaLabel !== undefined) node.setAttribute("aria-label", options.ariaLabel);
  append(node, children);
  return node;
};

export const append = (parent: Node, children: readonly Child[]): void => {
  for (const child of children) {
    if (child === false || child === null || child === undefined) continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
};

export const link = (label: string, href: string, className?: string): HTMLAnchorElement => {
  const anchor = element("a", { ...(className === undefined ? {} : { className }) }, [label]);
  anchor.href = href;
  return anchor;
};

export const button = (
  label: string,
  onClick: () => void,
  className = "button",
): HTMLButtonElement => {
  const node = element("button", { className }, [label]);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
};

export const codeBlock = (
  code: string,
  language = "text",
  ariaLabel = `${language} code example`,
): HTMLElement => {
  const highlighterLanguage = language === "shell" ? "bash" : language;
  const highlighted = hljs.getLanguage(highlighterLanguage)
    ? hljs.highlight(code, { language: highlighterLanguage, ignoreIllegals: true }).value
    : undefined;
  const shell = element("figure", { className: "code-shell" });
  const toolbar = element("figcaption", { className: "code-shell__toolbar" }, [
    element("span", { className: "code-shell__language" }, [language]),
  ]);
  const copyButton = element(
    "button",
    {
      className: "code-copy",
      title: "Copy code",
      ariaLabel: "Copy code",
    },
    ["copy"],
  );
  copyButton.type = "button";
  copyButton.addEventListener("click", () => {
    void copyText(code)
      .then(() => {
        copyButton.textContent = "copied";
        copyButton.classList.add("is-copied");
        window.setTimeout(() => {
          copyButton.textContent = "copy";
          copyButton.classList.remove("is-copied");
        }, 1_800);
      })
      .catch(() => {
        copyButton.textContent = "failed";
        copyButton.classList.add("is-failed");
        window.setTimeout(() => {
          copyButton.textContent = "copy";
          copyButton.classList.remove("is-failed");
        }, 1_800);
      });
  });
  toolbar.append(copyButton);
  const pre = element("pre", { className: "code-block", ariaLabel });
  const codeNode = element("code", { className: `hljs language-${language}` });
  if (highlighted === undefined) codeNode.textContent = code;
  else codeNode.innerHTML = highlighted;
  pre.append(codeNode);
  shell.append(toolbar, pre);
  return shell;
};

export const badge = (text: string, variant: string): HTMLElement =>
  element("span", { className: `badge badge--${variant}` }, [text]);

export const clear = (node: Element): void => node.replaceChildren();

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
  const pre = element("pre", { className: "code-block", ariaLabel });
  const codeNode = element("code", { className: `language-${language}` }, [code]);
  pre.append(codeNode);
  return pre;
};

export const badge = (text: string, variant: string): HTMLElement =>
  element("span", { className: `badge badge--${variant}` }, [text]);

export const clear = (node: Element): void => node.replaceChildren();

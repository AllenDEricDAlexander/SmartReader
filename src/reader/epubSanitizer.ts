const allowedTags = new Set([
  "a",
  "abbr",
  "article",
  "aside",
  "b",
  "blockquote",
  "br",
  "caption",
  "cite",
  "code",
  "dd",
  "del",
  "dfn",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "ins",
  "li",
  "main",
  "mark",
  "ol",
  "p",
  "pre",
  "q",
  "s",
  "section",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul"
]);

const removeWithContents = new Set([
  "applet",
  "audio",
  "canvas",
  "embed",
  "form",
  "frame",
  "frameset",
  "iframe",
  "img",
  "input",
  "link",
  "meta",
  "noscript",
  "object",
  "picture",
  "script",
  "select",
  "source",
  "style",
  "svg",
  "textarea",
  "video"
]);

const globalAttributes = new Set(["aria-label", "aria-hidden", "dir", "id", "lang", "title"]);

export function sanitizeEpubHtml(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  sanitizeNode(document.body);

  return document.body.innerHTML;
}

function sanitizeNode(node: Node): void {
  if (!(node instanceof Element)) {
    return;
  }

  if (node.tagName.toLowerCase() === "body") {
    sanitizeChildNodes(node);
    return;
  }

  sanitizeElement(node);
}

function sanitizeElement(element: Element): boolean {
  const tagName = element.tagName.toLowerCase();

  if (removeWithContents.has(tagName)) {
    element.remove();
    return false;
  }

  if (!allowedTags.has(tagName)) {
    sanitizeChildNodes(element);
    unwrapElement(element);
    return false;
  }

  sanitizeAttributes(element);
  sanitizeChildNodes(element);
  return true;
}

function sanitizeChildNodes(parent: Element): void {
  let child = parent.firstChild;

  while (child) {
    const next = child.nextSibling;
    sanitizeNode(child);
    child = next;
  }
}

function sanitizeAttributes(element: Element): void {
  const tagName = element.tagName.toLowerCase();

  Array.from(element.attributes).forEach((attribute) => {
    const name = attribute.name.toLowerCase();

    if (name.startsWith("on") || name === "style" || name === "src" || name === "srcset") {
      element.removeAttribute(attribute.name);
      return;
    }

    if (tagName === "a" && name === "href") {
      if (isSafeEpubHref(attribute.value)) {
        element.setAttribute("rel", "noreferrer noopener");
      } else {
        element.removeAttribute(attribute.name);
      }
      return;
    }

    if (!globalAttributes.has(name)) {
      element.removeAttribute(attribute.name);
    }
  });
}

function isSafeEpubHref(value: string): boolean {
  const trimmed = value.trim();

  return trimmed.startsWith("#");
}

function unwrapElement(element: Element): void {
  const parent = element.parentNode;

  if (!parent) {
    element.remove();
    return;
  }

  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element);
  }

  element.remove();
}

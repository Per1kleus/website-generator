import "server-only";

/**
 * Minimal SVG sanitiser for uploaded logos.
 *
 * An SVG is an executable document: it can carry <script>, event handlers,
 * external references and embedded foreign content. We never store or serve
 * the uploaded bytes — we strip everything active here, and the caller then
 * rasterises the result, so nothing script-bearing survives to the browser.
 *
 * Returns null when the input is not a plausible SVG.
 */
export function sanitiseSvg(source: string): string | null {
  if (!/<svg[\s>]/i.test(source)) return null;
  if (source.length > 2_000_000) return null;

  let out = source;

  // Elements that can execute, navigate, or pull in remote content.
  const dangerousElements = [
    "script", "foreignObject", "iframe", "embed", "object", "audio", "video",
    "animate", "animateTransform", "animateMotion", "set", "handler",
  ];
  for (const el of dangerousElements) {
    out = out.replace(new RegExp(`<${el}\\b[\\s\\S]*?</${el}\\s*>`, "gi"), "");
    out = out.replace(new RegExp(`<${el}\\b[^>]*/?>`, "gi"), "");
  }

  // Processing instructions, DOCTYPE (entity expansion) and comments.
  out = out.replace(/<\?[\s\S]*?\?>/g, "");
  out = out.replace(/<!DOCTYPE[\s\S]*?>/gi, "");
  out = out.replace(/<!--[\s\S]*?-->/g, "");

  // Inline event handlers: on* attributes in any quoting style.
  out = out.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "");
  out = out.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "");
  out = out.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "");

  // javascript:/data: URLs in href/xlink:href/src/style.
  out = out.replace(/(href|xlink:href|src)\s*=\s*"(?:\s*)(?:javascript|data|vbscript):[^"]*"/gi, "");
  out = out.replace(/(href|xlink:href|src)\s*=\s*'(?:\s*)(?:javascript|data|vbscript):[^']*'/gi, "");
  out = out.replace(/(url\(\s*['"]?\s*)(?:javascript|data|vbscript):[^)]*\)/gi, "none");

  if (!/<svg[\s>]/i.test(out)) return null;
  return out;
}

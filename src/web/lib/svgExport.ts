/**
 * Serialize a rendered Mermaid SVG as a standalone file. Mermaid embeds its theme
 * in a `<style>` element scoped by the SVG id, so the clone keeps the id and that
 * style; the export also gets explicit dimensions and an opaque background so it
 * stays readable outside the page (e.g. a dark-theme diagram in a light viewer).
 */
export function serializeSvg(svg: SVGSVGElement, background: string): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const box = (clone.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  const [x = 0, y = 0, w, h] = box.length === 4 && box.every(Number.isFinite) ? box : [0, 0, undefined, undefined];

  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  clone.removeAttribute("style");
  if (w !== undefined && h !== undefined) {
    clone.setAttribute("width", String(w));
    clone.setAttribute("height", String(h));
    const rect = clone.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", String(x));
    rect.setAttribute("y", String(y));
    rect.setAttribute("width", String(w));
    rect.setAttribute("height", String(h));
    rect.setAttribute("fill", background);
    // After the <style> (if any) so selectors still apply; before the drawing so it sits behind.
    const style = clone.querySelector(":scope > style");
    clone.insertBefore(rect, style ? style.nextSibling : clone.firstChild);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}\n`;
}

export function downloadText(text: string, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** `README.md` + `diagram-2` → `README-diagram-2.svg`. */
export function exportName(docName: string | null, suffix?: string): string {
  const base = (docName ?? "diagram").replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-") || "diagram";
  return `${base}${suffix ? `-${suffix}` : ""}.svg`;
}

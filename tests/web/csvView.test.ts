// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { build, type Rollup } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Vitest's shared config does not compile Svelte. Bundle the real component and its client
// runtime in memory, so these tests exercise the public DOM without generating files.
let runtime: {
  CsvView: typeof import("../../src/web/components/CsvView.svelte").default;
  mount: typeof import("svelte").mount;
  unmount: typeof import("svelte").unmount;
  flushSync: typeof import("svelte").flushSync;
};
let target: HTMLDivElement;
let style: HTMLStyleElement;
let component: Record<string, unknown> | undefined;

beforeAll(async () => {
  const result = await build({
    configFile: false,
    publicDir: false,
    logLevel: "silent",
    plugins: [
      {
        name: "csv-view-test-entry",
        resolveId(id) { return id === "virtual:csv-view-test" ? "\0csv-view-test" : null; },
        load(id) {
          return id === "\0csv-view-test"
            ? `export { default as CsvView } from ${JSON.stringify(fileURLToPath(new NodeURL("../../src/web/components/CsvView.svelte", import.meta.url)))}; export { mount, unmount, flushSync } from "svelte";`
            : null;
        },
      },
      ...svelte({ configFile: false, emitCss: false }),
    ],
    build: {
      write: false,
      minify: false,
      lib: { entry: "virtual:csv-view-test", formats: ["es"] },
      rollupOptions: { input: "virtual:csv-view-test" },
    },
  });
  const bundle = (Array.isArray(result) ? result[0] : result) as Rollup.RollupOutput;
  const output = bundle.output.find((item) => item.type === "chunk");
  if (!output || output.type !== "chunk") throw new Error("CSV view test bundle was not created");
  runtime = await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(output.code).toString("base64")}`);
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  style = document.createElement("style");
  style.textContent = readFileSync(new NodeURL("../../src/web/styles.css", import.meta.url), "utf8");
  document.head.append(style);
});

beforeEach(() => {
  localStorage.clear();
  target = document.createElement("div");
  document.body.append(target);
});

afterEach(async () => {
  if (component) await runtime.unmount(component);
  component = undefined;
  target.remove();
  vi.restoreAllMocks();
  localStorage.clear();
});

afterAll(() => {
  style?.remove();
  Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});

function render() {
  component = runtime.mount(runtime.CsvView, {
    target,
    props: {
      content: `name,amount\n${"long ".repeat(100)}needle,42`,
      name: "data.csv",
      label: "data.csv",
      manual: false,
      onoutline: () => {}, onactive: () => {}, onstatus: () => {}, onannounce: () => {},
    },
  });
  runtime.flushSync();
}

function wrapButton(): HTMLButtonElement {
  const button = [...target.querySelectorAll("button")].find((el) => el.textContent?.trim() === "Wrap text");
  if (!button) throw new Error("Wrap text button is missing");
  return button;
}

function table(): HTMLTableElement {
  return target.querySelector("#csv-table")!;
}

function click(button: HTMLButtonElement) {
  button.click();
  runtime.flushSync();
}

describe("CSV wrap text", () => {
  it("starts compact with an unpressed, keyboard-accessible wrap button", () => {
    render();
    expect(wrapButton().getAttribute("aria-pressed")).toBe("false");
    expect(wrapButton().type).toBe("button");
    expect(table().classList.contains("is-wrapped")).toBe(false);
    expect(table().querySelector("td.num")?.textContent).toBe("42");
  });

  it("toggles the table and pressed state in both directions", () => {
    render();
    const button = wrapButton();
    click(button);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(table().classList.contains("is-wrapped")).toBe(true);
    click(button);
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(table().classList.contains("is-wrapped")).toBe(false);
  });

  it("remembers both choices across remounts", async () => {
    render();
    click(wrapButton());
    await runtime.unmount(component!);
    component = undefined;
    render();
    expect(wrapButton().getAttribute("aria-pressed")).toBe("true");
    expect(table().classList.contains("is-wrapped")).toBe(true);
    click(wrapButton());
    await runtime.unmount(component!);
    component = undefined;
    render();
    expect(wrapButton().getAttribute("aria-pressed")).toBe("false");
    expect(table().classList.contains("is-wrapped")).toBe(false);
  });

  it("still toggles when storage reads and writes fail", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    render();
    expect(wrapButton().getAttribute("aria-pressed")).toBe("false");
    click(wrapButton());
    expect(wrapButton().getAttribute("aria-pressed")).toBe("true");
    expect(table().classList.contains("is-wrapped")).toBe(true);
  });

  it("still toggles when accessing localStorage itself fails", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new Error("denied"); });
    render();
    expect(wrapButton().getAttribute("aria-pressed")).toBe("false");
    click(wrapButton());
    expect(table().classList.contains("is-wrapped")).toBe(true);
  });

  it("wraps data cells without changing the sticky headers or numeric alignment", () => {
    render();
    const td = table().querySelector("tbody td")!;
    const cell = td.querySelector(".cell")!;
    const numeric = table().querySelector("tbody td.num")!;
    const header = table().querySelector("thead th")!;
    expect(getComputedStyle(td).whiteSpace).toBe("nowrap");
    expect(getComputedStyle(cell).textOverflow).toBe("ellipsis");
    click(wrapButton());
    expect(getComputedStyle(td).whiteSpace).toBe("normal");
    expect(getComputedStyle(td).verticalAlign).toBe("top");
    expect(getComputedStyle(cell).maxWidth).toBe("360px");
    expect(getComputedStyle(cell).overflow).toBe("visible");
    expect(getComputedStyle(cell).textOverflow).toBe("clip");
    expect(getComputedStyle(cell).overflowWrap).toBe("break-word");
    expect(getComputedStyle(header).whiteSpace).toBe("nowrap");
    expect(getComputedStyle(header).position).toBe("sticky");
    expect(getComputedStyle(numeric).textAlign).toBe("right");
  });

  it("marks a truncated current match in compact mode, but not in wrap mode", () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      return { right: this.tagName === "MARK" ? 100 : 20 } as DOMRect;
    });
    render();
    const search = target.querySelector<HTMLInputElement>('input[type="search"]')!;
    search.value = "needle";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    runtime.flushSync();
    const cell = table().querySelector("tbody td")!;
    expect(cell.querySelector("mark.is-current")?.textContent).toBe("needle");
    expect(cell.classList.contains("has-hidden-current")).toBe(true);
    click(wrapButton());
    expect(cell.querySelector("mark.is-current")?.textContent).toBe("needle");
    expect(cell.classList.contains("has-hidden-current")).toBe(false);
    click(wrapButton());
    expect(cell.classList.contains("has-hidden-current")).toBe(true);
  });
});

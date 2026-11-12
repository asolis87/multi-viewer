import { DOC_TYPES, type DocType } from "./doc.js";

/**
 * Manual type selection (S8): a manual choice overrides detection and is kept
 * across live reloads until the user picks another value.
 */
export interface TypeChoice {
  /** The type detected for the current content. */
  detected: DocType;
  /** The manual choice, or null for Auto. */
  override: DocType | null;
}

export type SelectValue = "auto" | DocType;

export function effectiveType(choice: TypeChoice): DocType {
  return choice.override ?? choice.detected;
}

export function selectValue(choice: TypeChoice): SelectValue {
  return choice.override ?? "auto";
}

export function choose(choice: TypeChoice, value: SelectValue): TypeChoice {
  return { ...choice, override: value === "auto" ? null : value };
}

/** A live reload replaces the detected type but never drops the manual choice. */
export function reload(choice: TypeChoice, detected: DocType): TypeChoice {
  return { ...choice, detected };
}

/** New content pasted in the page starts from detection again. */
export function freshContent(detected: DocType): TypeChoice {
  return { detected, override: null };
}

export const TYPE_LABEL: Record<DocType, string> = { markdown: "Markdown", mermaid: "Mermaid", json: "JSON", csv: "CSV" };

/** Manual options of the type selector, in `DOC_TYPES` order (S13: no hard-coded options). */
export const TYPE_OPTIONS: readonly { value: DocType; label: string }[] = DOC_TYPES.map((value) => ({
  value,
  label: TYPE_LABEL[value],
}));

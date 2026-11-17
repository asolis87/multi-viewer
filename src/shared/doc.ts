import type { DocType } from "./detect.js";

/** Where the document content came from. */
export type DocSource = "file" | "paste" | "stdin" | "empty";

/** The document served by `GET /api/doc` and rendered by the frontend. */
export interface Doc {
  name: string | null;
  type: DocType;
  content: string;
  source: DocSource;
  /** Set only by servers started by `mview review` (S17): the page shows the review UI. */
  review?: true;
}

/** The document shown when mview starts without any input: the page offers a paste area. */
export function emptyDoc(): Doc {
  return { name: null, type: "markdown", content: "", source: "empty" };
}

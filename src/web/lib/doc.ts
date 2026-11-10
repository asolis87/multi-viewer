// The frontend uses the shared contract; it never redefines Doc or detection.
export { emptyDoc, type Doc, type DocSource } from "../../shared/doc.js";
export { detectType, DOC_TYPES, type DocType } from "../../shared/detect.js";

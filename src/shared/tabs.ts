export interface DocumentTabs {
  tabs: { id: string; name: string }[];
  /** Last selection made by the CLI; local tab clicks don't write to the server. */
  active: string;
  revision: number;
}

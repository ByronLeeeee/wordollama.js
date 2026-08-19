import { OfficeJsToolRegistry } from "../apps/addin/src/officejs-tool-registry.ts";
import { OfficeJsWordAdapter } from "../apps/addin/src/officejs-word-adapter.ts";

type RequirementSet = "WordApi" | "WordApiDesktop";
type HostProfile = {
  name: string;
  supported: Partial<Record<RequirementSet, string>>;
  expectedCount: number;
  unavailable: string[];
};

const profiles: HostProfile[] = [
  {
    name: "Word 2016 baseline",
    supported: { WordApi: "1.1" },
    expectedCount: 22,
    unavailable: [
      "get_selection",
      "select_exact_text",
      "insert_at_cursor",
      "format_text",
      "insert_page_break",
      "read_comments",
      "read_bookmarks",
      "add_comment",
      "read_table",
      "table_insert_row",
      "table_set_cell",
      "insert_image",
      "edit_table_structure",
      "format_table",
      "format_list",
      "page_setup",
      "update_toc",
      "apply_precise_revision",
    ],
  },
  {
    name: "WordApi 1.4 cross-platform",
    supported: { WordApi: "1.4" },
    expectedCount: 36,
    unavailable: ["read_bookmarks", "format_list", "page_setup", "update_toc"],
  },
  {
    name: "WordApiDesktop 1.3",
    supported: { WordApi: "1.4", WordApiDesktop: "1.3" },
    expectedCount: 38,
    unavailable: ["read_bookmarks", "update_toc"],
  },
  {
    name: "Microsoft 365 desktop",
    supported: { WordApi: "1.4", WordApiDesktop: "1.4" },
    expectedCount: 40,
    unavailable: [],
  },
];

function versionAtLeast(actual: string | undefined, required: string): boolean {
  if (!actual) return false;
  const actualParts = actual.split(".").map(Number);
  const requiredParts = required.split(".").map(Number);
  for (let index = 0; index < requiredParts.length; index += 1) {
    const actualPart = actualParts[index] ?? 0;
    if (actualPart !== requiredParts[index]) return actualPart > requiredParts[index];
  }
  return true;
}

for (const profile of profiles) {
  (globalThis as Record<string, unknown>).Office = {
    context: {
      requirements: {
        isSetSupported: (set: RequirementSet, version: string) =>
          versionAtLeast(profile.supported[set], version),
      },
    },
  };

  const names = new OfficeJsToolRegistry(new OfficeJsWordAdapter()).list().map((tool) => tool.name);
  if (names.length !== profile.expectedCount) {
    throw new Error(`${profile.name}: expected ${profile.expectedCount} tools, got ${names.length}`);
  }
  for (const unavailable of profile.unavailable) {
    if (names.includes(unavailable)) {
      throw new Error(`${profile.name}: unsupported tool exposed: ${unavailable}`);
    }
  }
}

console.log(`Office.js host capability matrix passed (${profiles.length} profiles).`);

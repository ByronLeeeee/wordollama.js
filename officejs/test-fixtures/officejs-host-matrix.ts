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
    expectedCount: 31,
    unavailable: [
      "read_comments",
      "add_comment",
      "insert_image",
      "edit_table_structure",
      "format_table",
      "page_setup",
      "update_toc",
    ],
  },
  {
    name: "WordApi 1.4 cross-platform",
    supported: { WordApi: "1.4" },
    expectedCount: 36,
    unavailable: ["page_setup", "update_toc"],
  },
  {
    name: "WordApiDesktop 1.3",
    supported: { WordApi: "1.4", WordApiDesktop: "1.3" },
    expectedCount: 37,
    unavailable: ["update_toc"],
  },
  {
    name: "Microsoft 365 desktop",
    supported: { WordApi: "1.4", WordApiDesktop: "1.4" },
    expectedCount: 38,
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

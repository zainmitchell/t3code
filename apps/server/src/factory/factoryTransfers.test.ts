import { assert, describe, it } from "@effect/vitest";

import { declaresOwnedFiles, namesOwnedFiles } from "./factoryTransfers.ts";

const owned = ["## Owned files", "- `src/api.py`", "- `src/Data/my_file.py`"].join("\n");
const marked = (marker: string) => `${marker}\n${owned}`;

describe("namesOwnedFiles", () => {
  // BTC compares paths by its own identity: case, `.` segments and empty entries do not matter.
  it.each([
    ["no btc-unit marker", owned],
    [
      "the listed files in another order and spelling",
      marked("<!-- btc-unit:builder writes=src/data/MY_FILE.py;./src/api.py resources=gpu;ocr -->"),
    ],
    [
      "empty write entries and resources none",
      marked("<!-- btc-unit:builder writes=;src/api.py;;src/Data/my_file.py; resources=none -->"),
    ],
  ])("accepts a scope with %s", (_, body) => {
    assert.isTrue(namesOwnedFiles(body));
  });

  it.each([
    [
      "writes of one listed file",
      marked("<!-- btc-unit:builder writes=src/api.py resources=none -->"),
    ],
    [
      "writes of the directory holding them",
      marked("<!-- btc-unit:builder writes=src resources=none -->"),
    ],
    [
      "writes of an extra file",
      marked(
        "<!-- btc-unit:builder writes=src/api.py;src/Data/my_file.py;src/c.py resources=none -->",
      ),
    ],
    ["no writes", marked("<!-- btc-unit:builder resources=none -->")],
    ["only empty writes", marked("<!-- btc-unit:builder writes=; resources=none -->")],
    ["no resources", marked("<!-- btc-unit:builder writes=src/api.py;src/Data/my_file.py -->")],
    [
      "an unknown resource",
      marked("<!-- btc-unit:builder writes=src/api.py;src/Data/my_file.py resources=gpu;disk -->"),
    ],
    [
      "a write BTC cannot place",
      marked("<!-- btc-unit:builder writes=src/api.py;../src/Data/my_file.py resources=none -->"),
    ],
    [
      "a listed file BTC cannot place",
      [
        "<!-- btc-unit:builder writes=src/api.py resources=none -->",
        "## Owned files",
        "- `src/api.py`",
        "- `/src/api.py`",
      ].join("\n"),
    ],
    [
      "a marker BTC does not parse",
      marked("<!--btc-unit:builder writes=src/api.py;src/Data/my_file.py resources=none -->"),
    ],
    [
      "a second marker",
      marked(
        [
          "<!-- btc-unit:builder writes=src/api.py;src/Data/my_file.py resources=none -->",
          "<!-- btc-unit:builder writes=src/api.py;src/Data/my_file.py resources=none -->",
        ].join("\n"),
      ),
    ],
  ])("refuses a btc-unit marker with %s", (_, body) => {
    assert.isFalse(namesOwnedFiles(body));
  });
});

describe("declaresOwnedFiles", () => {
  const files = ["src/api.py", "src/Data/my_file.py"];
  it.each<[string, string, ReadonlyArray<string>]>([
    ["an HSA section", owned, files],
    [
      "an HSA section a BTC marker names",
      marked("<!-- btc-unit:builder writes=src/data/MY_FILE.py;./src/api.py resources=gpu -->"),
      files,
    ],
    [
      "a BTC marker alone, by BTC's path identity",
      "<!-- btc-unit:builder writes=SRC/api.py resources=none -->",
      ["src/api.py"],
    ],
    ["HSA's None for a verification-only unit", "## Owned files\n\nNone\n", []],
  ])("reads %s as exactly its owned files", (_, body, claimed) => {
    assert.isTrue(declaresOwnedFiles(body, claimed));
  });

  it.each<[string, string, ReadonlyArray<string>]>([
    ["a narrower claim", owned, ["src/api.py"]],
    ["a broader claim", owned, [...files, "src/extra.py"]],
    ["a directory for its files", owned, ["src"]],
    ["files for None", "## Owned files\n\nNone\n", ["src/api.py"]],
  ])("refuses %s", (_, body, claimed) => {
    assert.isFalse(declaresOwnedFiles(body, claimed));
  });

  it.each([
    ["no declaration", "Proof of the send path."],
    [
      "a connector-unit marker, which it does not read",
      "<!-- connector-unit writes=src/ effort=high -->",
    ],
    ["a section with prose", "## Owned files\n\nthe api module\n"],
    ["None beside files", "## Owned files\n\nNone\n- `src/api.py`\n"],
    [
      "a BTC marker that disagrees with the section",
      marked("<!-- btc-unit:builder writes=src/api.py resources=none -->"),
    ],
    [
      "two BTC markers",
      "<!-- btc-unit:builder writes=a.py resources=none -->\n<!-- btc-unit:builder writes=a.py resources=none -->",
    ],
  ])("cannot read %s", (_, body) => {
    assert.isUndefined(declaresOwnedFiles(body, []));
  });

  it("leaves the transfer scope rule as it was: None is no scope there", () => {
    assert.isFalse(namesOwnedFiles("## Owned files\n\nNone\n"));
  });
});

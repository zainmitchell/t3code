import { assert, describe, it } from "@effect/vitest";

import { declaresOwnedFiles, namesOwnedFiles } from "./factoryTransfers.ts";

const owned = ["## Owned files", "- `src/api.py`", "- `src/Data/my_file.py`"].join("\n");
const marked = (marker: string) => `${marker}\n${owned}`;

describe("namesOwnedFiles", () => {
  // BETA compares paths by its own identity: case, `.` segments and empty entries do not matter.
  it.each([
    ["no beta-unit marker", owned],
    [
      "the listed files in another order and spelling",
      marked(
        "<!-- beta-unit:builder writes=src/data/MY_FILE.py;./src/api.py resources=gpu;ocr -->",
      ),
    ],
    [
      "empty write entries and resources none",
      marked("<!-- beta-unit:builder writes=;src/api.py;;src/Data/my_file.py; resources=none -->"),
    ],
  ])("accepts a scope with %s", (_, body) => {
    assert.isTrue(namesOwnedFiles(body));
  });

  it.each([
    [
      "writes of one listed file",
      marked("<!-- beta-unit:builder writes=src/api.py resources=none -->"),
    ],
    [
      "writes of the directory holding them",
      marked("<!-- beta-unit:builder writes=src resources=none -->"),
    ],
    [
      "writes of an extra file",
      marked(
        "<!-- beta-unit:builder writes=src/api.py;src/Data/my_file.py;src/c.py resources=none -->",
      ),
    ],
    ["no writes", marked("<!-- beta-unit:builder resources=none -->")],
    ["only empty writes", marked("<!-- beta-unit:builder writes=; resources=none -->")],
    ["no resources", marked("<!-- beta-unit:builder writes=src/api.py;src/Data/my_file.py -->")],
    [
      "an unknown resource",
      marked("<!-- beta-unit:builder writes=src/api.py;src/Data/my_file.py resources=gpu;disk -->"),
    ],
    [
      "a write BETA cannot place",
      marked("<!-- beta-unit:builder writes=src/api.py;../src/Data/my_file.py resources=none -->"),
    ],
    [
      "a listed file BETA cannot place",
      [
        "<!-- beta-unit:builder writes=src/api.py resources=none -->",
        "## Owned files",
        "- `src/api.py`",
        "- `/src/api.py`",
      ].join("\n"),
    ],
    [
      "a marker BETA does not parse",
      marked("<!--beta-unit:builder writes=src/api.py;src/Data/my_file.py resources=none -->"),
    ],
    [
      "a second marker",
      marked(
        [
          "<!-- beta-unit:builder writes=src/api.py;src/Data/my_file.py resources=none -->",
          "<!-- beta-unit:builder writes=src/api.py;src/Data/my_file.py resources=none -->",
        ].join("\n"),
      ),
    ],
  ])("refuses a beta-unit marker with %s", (_, body) => {
    assert.isFalse(namesOwnedFiles(body));
  });
});

describe("declaresOwnedFiles", () => {
  const files = ["src/api.py", "src/Data/my_file.py"];
  it.each<[string, string, ReadonlyArray<string>]>([
    ["an ALPHA section", owned, files],
    [
      "an ALPHA section a BETA marker names",
      marked("<!-- beta-unit:builder writes=src/data/MY_FILE.py;./src/api.py resources=gpu -->"),
      files,
    ],
    [
      "a BETA marker alone, by BETA's path identity",
      "<!-- beta-unit:builder writes=SRC/api.py resources=none -->",
      ["src/api.py"],
    ],
    ["ALPHA's None for a verification-only unit", "## Owned files\n\nNone\n", []],
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
    ["a section with prose", "## Owned files\n\nthe api module\n"],
    ["None beside files", "## Owned files\n\nNone\n- `src/api.py`\n"],
    [
      "a BETA marker that disagrees with the section",
      marked("<!-- beta-unit:builder writes=src/api.py resources=none -->"),
    ],
    [
      "two BETA markers",
      "<!-- beta-unit:builder writes=a.py resources=none -->\n<!-- beta-unit:builder writes=a.py resources=none -->",
    ],
  ])("cannot read %s", (_, body) => {
    assert.isUndefined(declaresOwnedFiles(body, []));
  });

  it("leaves the transfer scope rule as it was: None is no scope there", () => {
    assert.isFalse(namesOwnedFiles("## Owned files\n\nNone\n"));
  });
});

describe("declaresOwnedFiles: the connector unit", () => {
  const unit = (fields: string) => `Synthetic unit.\n\n<!-- connector-unit ${fields} -->\n`;
  it.each<[string, string, ReadonlyArray<string>]>([
    [
      "writes alone, its directory reservation whole",
      unit("writes=docs/p1/ effort=high"),
      ["docs/p1/"],
    ],
    [
      "writes with narrower edits inside them",
      unit("writes=src/;tests/proof/ edits=src/a.py;tests/proof/ effort=medium closure=whole"),
      ["src/", "tests/proof/"],
    ],
    [
      "the policy's own path cleaning",
      unit("writes=./src/b.py;`src/a.py`;src/a.py"),
      ["src/a.py", "src/b.py"],
    ],
    ["a marker closed without a space", "<!-- connector-unit writes=src/-->", ["src/"]],
  ])("reads %s", (_, body, claimed) => {
    assert.isTrue(declaresOwnedFiles(body, claimed));
  });

  it.each<[string, string, ReadonlyArray<string>]>([
    ["its edits for its writes", unit("writes=src/ edits=src/a.py"), ["src/a.py"]],
    ["a narrower claim", unit("writes=src/;docs/"), ["src/"]],
    ["a broader claim", unit("writes=src/a.py"), ["src/"]],
    ["another spelling of a directory", unit("writes=src/"), ["src"]],
    ["an unsafe claimed path", unit("writes=src/"), ["../src/"]],
  ])("refuses %s", (_, body, claimed) => {
    assert.isFalse(declaresOwnedFiles(body, claimed));
  });

  it.each([
    ["two markers", `${unit("writes=src/")}${unit("writes=src/")}`],
    ["a field given twice", unit("writes=src/ writes=docs/")],
    ["an unknown field", unit("writes=src/ owner=me")],
    ["an unknown effort", unit("writes=src/ effort=low")],
    ["an unknown closure", unit("writes=src/ closure=partial")],
    ["no writes", unit("edits=src/a.py")],
    ["an empty write entry", unit("writes=src/;;docs/")],
    ["an absolute write", unit("writes=/etc/")],
    ["a write that climbs", unit("writes=src/../secrets/")],
    ["an edit outside its writes", unit("writes=src/ edits=docs/a.md")],
    ["a marker the policy cannot parse", "<!--connector-unit writes=src/ -->"],
    ["a mention beside the marker", `connector-unit notes\n${unit("writes=src/")}`],
    [
      "a connector unit beside an ALPHA section",
      `${unit("writes=src/")}\n## Owned files\n\n- \`src/a.py\`\n`,
    ],
    [
      "a connector unit beside a BETA marker",
      `${unit("writes=src/")}\n<!-- beta-unit:builder writes=src/a.py resources=none -->`,
    ],
  ])("cannot read %s", (_, body) => {
    assert.isUndefined(declaresOwnedFiles(body, ["src/"]));
  });

  it("leaves transfer scope as it was: a connector unit names no transfer scope", () => {
    assert.isFalse(namesOwnedFiles(unit("writes=src/a.py")));
  });
});

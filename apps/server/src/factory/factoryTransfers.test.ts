import { assert, describe, it } from "@effect/vitest";

import { namesOwnedFiles } from "./factoryTransfers.ts";

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

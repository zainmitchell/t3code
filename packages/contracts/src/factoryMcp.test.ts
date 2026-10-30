import { assert, describe, expect, it } from "@effect/vitest";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  FactoryReportInput,
  factoryCardRequestId,
  isFactoryCardRequestId,
  parseFactoryCardRequestId,
} from "./factoryMcp.ts";

describe("factory card request ids", () => {
  it("reads every id a factory issued as a card, whichever build wrote it", () => {
    const encoded = factoryCardRequestId({
      factoryId: "hsa-native-pilot-20261024",
      kind: "result",
      subjectId: "no-result:reservation:factory:hsa:decision:9c1",
      n: 2,
    });
    expect(parseFactoryCardRequestId(encoded)).toEqual({
      factoryId: "hsa-native-pilot-20261024",
      kind: "result",
      subjectId: "no-result:reservation:factory:hsa:decision:9c1",
      n: 2,
      legacy: false,
    });
    expect(parseFactoryCardRequestId("factory-card:hsa:gate:4b11fbb6ef54:1")).toEqual({
      factoryId: "hsa",
      kind: "gate",
      subjectId: "4b11fbb6ef54",
      n: 1,
      legacy: false,
    });
    // An earlier build wrote a subject with colons as it was: still its card, never answerable.
    expect(
      parseFactoryCardRequestId("factory-card:btc:result:native:integrate:6dfed19f:1"),
    ).toEqual({
      factoryId: "btc",
      kind: "result",
      subjectId: "native:integrate:6dfed19f",
      n: 1,
      legacy: true,
    });
    for (const id of [
      encoded,
      "factory-card:btc:result:native:integrate:6dfed19f:1",
      "factory-card:btc:result:no-result:9c1:3",
      "factory-card:btc:result:%E0%A4%A:1",
      "factory-card:btc",
    ]) {
      expect(isFactoryCardRequestId(id), id).toBe(true);
    }
    expect(parseFactoryCardRequestId("factory-card:btc:result:%E0%A4%A:1")).toBeUndefined();
    expect(isFactoryCardRequestId("request:provider:42")).toBe(false);
  });
});

describe("criteria proposal reports", () => {
  const decode = Schema.decodeUnknownOption(FactoryReportInput);
  const clause = (excerpt: string, start = 10) => ({
    id: "N1",
    source: { start, end: start + [...excerpt].length, sha256: "a".repeat(64), excerpt },
  });
  const report = (clauses: ReadonlyArray<unknown>, change: Record<string, unknown> = {}) => ({
    outcome: "criteria_proposed",
    summary: "Clauses.",
    criteria: {
      schema: "factory-parent-criteria-proposal/1",
      issue: 27,
      basis: { bodySha256: "b".repeat(64), itemVersion: "v27" },
      clauses,
      ...change,
    },
  });

  it("decodes only bounded, exactly measured quotes", () => {
    // Offsets count code points: an astral character is one.
    assert.isTrue(Option.isSome(decode(report([clause("keeps 🚀 order")]))));
    assert.isTrue(
      Option.isSome(
        decode(
          report([
            {
              ...clause("cites the rule"),
              comments: [{ id: "777", start: 0, end: 4, sha256: "c".repeat(64), excerpt: "Rule" }],
              needs: { kind: "qualification", what: "who certifies it" },
            },
          ]),
        ),
      ),
    );
    const refused: ReadonlyArray<readonly [string, unknown]> = [
      ["no clause", report([])],
      [
        "a span longer than its excerpt",
        report([{ ...clause("abc"), source: { ...clause("abc").source, end: 20 } }]),
      ],
      [
        "an empty span",
        report([{ ...clause("abc"), source: { ...clause("abc").source, end: 10 } }]),
      ],
      [
        "a digest that is not sha256",
        report([{ ...clause("abc"), source: { ...clause("abc").source, sha256: "A".repeat(64) } }]),
      ],
      ["more than 200 clauses", report(Array.from({ length: 201 }, () => clause("x")))],
      [
        "more than 65536 quoted characters",
        report(Array.from({ length: 9 }, () => clause("x".repeat(8_000)))),
      ],
      [
        "a need that is not a person's",
        report([{ ...clause("abc"), needs: { kind: "evidence", what: "x" } }]),
      ],
      [
        "a comment id that is not a number",
        report([
          {
            ...clause("abc"),
            comments: [{ id: "abc", start: 0, end: 1, sha256: "c".repeat(64), excerpt: "R" }],
          },
        ]),
      ],
      ["another schema", report([clause("abc")], { schema: "factory-parent-criteria/1" })],
      [
        "a body digest that is not sha256",
        report([clause("abc")], { basis: { bodySha256: "x", itemVersion: "v" } }),
      ],
    ];
    for (const [name, input] of refused) assert.isTrue(Option.isNone(decode(input)), name);
  });
});

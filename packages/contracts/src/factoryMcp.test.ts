import { describe, expect, it } from "@effect/vitest";

import {
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

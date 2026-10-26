import { assert, describe, it } from "@effect/vitest";

import { type ItemEvent, nextStage, stageBasis } from "./factoryStages.ts";

let seq = 0;
const admitted = (stage: Extract<ItemEvent, { type: "admitted" }>["stage"]): ItemEvent => ({
  type: "admitted",
  seq: ++seq,
  stage,
});
const outcome = (
  kind: Extract<ItemEvent, { type: "outcome" }>["kind"],
  fields: Partial<Omit<Extract<ItemEvent, { type: "outcome" }>, "type" | "seq" | "kind">> = {},
): ItemEvent => ({ type: "outcome", seq: ++seq, outcomeId: `o${seq}`, kind, ...fields });

describe("factory stages", () => {
  it("N26/N27: implement, review, integrate, close, done", () => {
    const events: Array<ItemEvent> = [];
    assert.deepStrictEqual(nextStage(events), { type: "implement" });
    events.push(admitted("implement"), outcome("implemented", { head: "aaa1111" }));
    const review = nextStage(events);
    assert.deepStrictEqual(review, { type: "review", outcomeId: "o2", head: "aaa1111" });
    events.push(admitted("review"), outcome("review_passed", { head: "aaa1111" }));
    assert.deepStrictEqual(nextStage(events), {
      type: "integrate",
      reviewOutcomeId: "o4",
      head: "aaa1111",
    });
    events.push(admitted("integrate"), outcome("integrated"));
    assert.deepStrictEqual(nextStage(events), { type: "close", integrationOutcomeId: "o6" });
    events.push(admitted("close"), outcome("closed"));
    assert.deepStrictEqual(nextStage(events), { type: "done", closureOutcomeId: "o8" });
  });

  it("N10: every failed review gets one correction, then rework and review, with no cap", () => {
    const events: Array<ItemEvent> = [
      admitted("implement"),
      outcome("implemented", { head: "h0" }),
    ];
    for (let cycle = 1; cycle <= 6; cycle++) {
      events.push(admitted("review"));
      events.push(outcome("review_failed", { head: `h${cycle - 1}`, failureDigest: `f${cycle}` }));
      const correct = nextStage(events);
      assert.strictEqual(correct.type, "correct");
      assert.strictEqual(stageBasis(correct as never), `correct:f${cycle}`);
      events.push(admitted("correct"), outcome("correction_spec", { corrects: `f${cycle}` }));
      const rework = nextStage(events);
      assert.strictEqual(rework.type, "rework");
      events.push(admitted("rework"), outcome("implemented", { head: `h${cycle}` }));
      assert.deepStrictEqual(nextStage(events).type, "review");
    }
    events.push(admitted("review"), outcome("review_passed", { head: "h6" }));
    assert.strictEqual(nextStage(events).type, "integrate");
  });

  it("a review counts only for the exact head it names", () => {
    const events = [
      admitted("implement"),
      outcome("implemented", { head: "new" }),
      outcome("review_passed", { head: "old" }),
    ];
    assert.deepStrictEqual(nextStage(events).type, "review");
  });

  it("N29: a typed failure without a commit can be corrected, never integrated", () => {
    const events = [admitted("implement"), outcome("failed", { failureDigest: "build-broke" })];
    assert.deepStrictEqual(nextStage(events), {
      type: "correct",
      outcomeId: "o" + String(seq),
      failureDigest: "build-broke",
    });
    const integrateAfter = [
      ...events,
      admitted("correct"),
      outcome("correction_spec", { corrects: "build-broke" }),
      outcome("integrated"),
    ];
    assert.strictEqual(nextStage(integrateAfter).type, "rework");
  });

  it("N09: a late success landing after the newest attempt was claimed is reviewed", () => {
    const events = [
      admitted("implement"),
      admitted("rework"),
      outcome("failed", { failureDigest: "newer-failed" }),
      // The older attempt's result lands late, after the newer attempt was claimed.
      outcome("implemented", { head: "late" }),
    ];
    assert.deepStrictEqual(nextStage(events), {
      type: "review",
      outcomeId: "o" + String(seq),
      head: "late",
    });
  });

  it("N09/D1: a newer attempt claimed before a late success cannot dispose of it by failing", () => {
    const events: Array<ItemEvent> = [admitted("implement")];
    const newer = admitted("rework");
    events.push(newer);
    // The older attempt's success lands; then the newer attempt, claimed before it, releases.
    const late = outcome("implemented", { head: "late", stage: "implement" });
    events.push(
      late,
      outcome("failed", {
        failureDigest: "newer-released",
        stage: "rework",
        admittedSeq: newer.seq,
      }),
    );
    assert.deepStrictEqual(nextStage(events), {
      type: "review",
      outcomeId: (late as Extract<ItemEvent, { type: "outcome" }>).outcomeId,
      head: "late",
    });
    // An attempt claimed after the success landed did dispose of it when it was claimed.
    const after = admitted("rework");
    const disposed = [
      ...events,
      after,
      outcome("failed", { failureDigest: "after", stage: "rework", admittedSeq: after.seq }),
    ];
    assert.strictEqual(nextStage(disposed).type, "correct");
  });

  it("N32: an explicitly rejected result is never reviewed again, even when it lands late", () => {
    const events: Array<ItemEvent> = [admitted("implement")];
    const result = outcome("implemented", { head: "rejected-head", stage: "implement" });
    const resultId = (result as Extract<ItemEvent, { type: "outcome" }>).outcomeId;
    events.push(result, {
      type: "rejected",
      seq: ++seq,
      outcomeId: resultId,
      failureDigest: "owner-rejected",
    });
    assert.deepStrictEqual(nextStage(events), {
      type: "correct",
      outcomeId: resultId,
      failureDigest: "owner-rejected",
    });
    // A replay of the same outcome record after the rejection changes nothing.
    events.push({ ...result, seq: ++seq } as ItemEvent);
    assert.strictEqual(nextStage(events).type, "correct");
  });

  it("N22: a review or correction that ends without a result is retried on a new basis", () => {
    const events: Array<ItemEvent> = [
      admitted("implement"),
      outcome("implemented", { head: "h1", stage: "implement" }),
      admitted("review"),
      outcome("failed", { failureDigest: "no-result-r1", stage: "review" }),
    ];
    const review = nextStage(events);
    assert.strictEqual(review.type, "review");
    assert.strictEqual(stageBasis(review as never), "review:h1:retry:no-result-r1");
    events.push(admitted("review"), outcome("review_failed", { head: "h1", failureDigest: "f1" }));
    events.push(
      admitted("correct"),
      outcome("failed", { failureDigest: "no-spec", stage: "correct" }),
    );
    const correct = nextStage(events);
    assert.strictEqual(stageBasis(correct as never), "correct:f1:retry:no-spec");
  });

  it("N32: a success a later rework was claimed from is not sent back to review", () => {
    const events = [
      admitted("implement"),
      outcome("implemented", { head: "first" }),
      admitted("review"),
      outcome("review_failed", { head: "first", failureDigest: "rejected" }),
      admitted("correct"),
      outcome("correction_spec", { corrects: "rejected" }),
      admitted("rework"),
    ];
    // The rework is outstanding; the rejected first head is disposed of, not reviewed again.
    assert.notStrictEqual(nextStage(events).type, "review");
    const reworkFailed = [...events, outcome("failed", { failureDigest: "rework-broke" })];
    assert.deepStrictEqual(nextStage(reworkFailed).type, "correct");
  });
});

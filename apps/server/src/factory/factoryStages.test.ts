import { assert, describe, it } from "@effect/vitest";

import { type ItemEvent, nextStage, PARENT_CLOSURE, stageBasis } from "./factoryStages.ts";

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

  it("a parent's own closure on its criteria is done; a stray closure, a rejected one or a reopen is not", () => {
    const parentClosure = (id: string): ItemEvent => ({
      type: "outcome",
      seq: ++seq,
      outcomeId: `${PARENT_CLOSURE}${id}`,
      kind: "closed",
    });
    const opened = outcome("ticket_opened");
    const closure = parentClosure("a");
    assert.deepStrictEqual(nextStage([opened, closure]), {
      type: "done",
      closureOutcomeId: closure.type === "outcome" ? closure.outcomeId : "",
    });
    // Any other closure without an integration is no end of an item.
    assert.deepStrictEqual(nextStage([opened, outcome("closed")]), { type: "implement" });
    assert.deepStrictEqual(
      nextStage([
        closure,
        { type: "rejected", seq: ++seq, outcomeId: `${PARENT_CLOSURE}a`, failureDigest: "x" },
      ]).type,
      "implement",
    );
    const reopened: ItemEvent = {
      type: "reopened",
      seq: ++seq,
      closureOutcomeId: `${PARENT_CLOSURE}a`,
    };
    assert.deepStrictEqual(nextStage([closure, reopened]), {
      type: "implement",
      reopenOf: `${PARENT_CLOSURE}a`,
    });
    const again = parentClosure("b");
    assert.strictEqual(nextStage([closure, reopened, again]).type, "done");
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

describe("same-head re-review on new verified evidence (HSA #84)", () => {
  // #84: implemented at d1c7, its review failed for missing acceptance proof, the correction asked for a
  // verification run at the same head, and the rework reported that head again.
  const reviewedOnce = () => [
    admitted("implement"),
    outcome("implemented", { head: "d1c7" }),
    admitted("review"),
    outcome("review_failed", { head: "d1c7", failureDigest: "rv84" }),
    admitted("correct"),
    outcome("correction_spec", { corrects: "rv84" }),
    admitted("rework"),
  ];
  const basisOf = (events: ReadonlyArray<ItemEvent>) => {
    const stage = nextStage(events);
    assert.strictEqual(stage.type, "review");
    return stageBasis(stage as never);
  };

  it("a rework at the reviewed head with new verified evidence is a new review decision", () => {
    const first = basisOf(reviewedOnce().slice(0, 2));
    const again = basisOf([
      ...reviewedOnce(),
      outcome("implemented", { head: "d1c7", evidenceDigest: "e1" }),
    ]);
    assert.strictEqual(first, "review:d1c7");
    assert.strictEqual(again, "review:d1c7:evidence:e1");
  });

  it("an unchanged basis is the same decision: no evidence, or evidence already reviewed", () => {
    // The rework that only rebound its record (711a7216) brings nothing new: the decision already made.
    assert.strictEqual(
      basisOf([...reviewedOnce(), outcome("implemented", { head: "d1c7" })]),
      "review:d1c7",
    );
    const withEvidence = [
      ...reviewedOnce(),
      outcome("implemented", { head: "d1c7", evidenceDigest: "e1" }),
    ];
    const reviewedAgain = [
      ...withEvidence,
      admitted("review"),
      outcome("review_failed", { head: "d1c7", failureDigest: "rv84b" }),
      admitted("correct"),
      outcome("correction_spec", { corrects: "rv84b" }),
      admitted("rework"),
    ];
    // The same verified evidence reported again is the review already made on it.
    assert.strictEqual(
      basisOf([...reviewedAgain, outcome("implemented", { head: "d1c7", evidenceDigest: "e1" })]),
      "review:d1c7:evidence:e1",
    );
    assert.strictEqual(basisOf(withEvidence), "review:d1c7:evidence:e1");
    // Different verified evidence is a different review.
    assert.strictEqual(
      basisOf([...reviewedAgain, outcome("implemented", { head: "d1c7", evidenceDigest: "e2" })]),
      "review:d1c7:evidence:e2",
    );
  });

  it("a first review keeps its basis, with or without evidence, so no in-flight decision changes", () => {
    assert.strictEqual(
      basisOf([
        admitted("implement"),
        outcome("implemented", { head: "a1", evidenceDigest: "e1" }),
      ]),
      "review:a1",
    );
    // A new head is reviewed on its head alone, as before.
    assert.strictEqual(
      basisOf([...reviewedOnce(), outcome("implemented", { head: "b2", evidenceDigest: "e1" })]),
      "review:b2",
    );
  });

  it("new evidence earns only a fresh independent review, never integration", () => {
    const events = [
      ...reviewedOnce(),
      outcome("implemented", { head: "d1c7", evidenceDigest: "e1" }),
    ];
    assert.strictEqual(nextStage(events).type, "review");
    events.push(admitted("review"), outcome("review_passed", { head: "d1c7" }));
    assert.strictEqual(nextStage(events).type, "integrate");
  });
});

describe("decomposition (triage)", () => {
  it("a triage and its proposal leave the item at its first build", () => {
    const events: Array<ItemEvent> = [
      admitted("triage"),
      outcome("unit_proposed", { stage: "triage" }),
    ];
    assert.deepStrictEqual(nextStage(events), { type: "implement" });
    events.push(admitted("triage"), outcome("not_actionable", { stage: "triage" }));
    assert.deepStrictEqual(nextStage(events), { type: "implement" });
  });

  it("a triage that ended without a result is no failure of the work", () => {
    const events = [
      admitted("triage"),
      outcome("failed", { stage: "triage", failureDigest: "t1" }),
    ];
    assert.deepStrictEqual(nextStage(events), { type: "implement" });
  });

  it("a build after a triage proceeds as an ordinary implementation", () => {
    const events = [
      admitted("triage"),
      outcome("unit_proposed", { stage: "triage" }),
      admitted("implement"),
      outcome("implemented", { head: "t0" }),
    ];
    const review = nextStage(events);
    assert.strictEqual(review.type, "review");
  });

  it("an opened correction ticket leaves a correction stage where it was", () => {
    const events = [
      admitted("implement"),
      outcome("failed", { stage: "implement", failureDigest: "v1" }),
      outcome("ticket_opened", { stage: "correct" }),
    ];
    const correct = nextStage(events);
    assert.strictEqual(correct.type, "correct");
    assert.strictEqual(stageBasis(correct as never), "correct:v1");
  });
});

describe("reopened items (BTC #14)", () => {
  const closedLineage = (head: string): Array<ItemEvent> => [
    admitted("implement"),
    outcome("implemented", { head }),
    admitted("review"),
    outcome("review_passed", { head }),
    outcome("integrated", { stage: "integrate" }),
    outcome("closed", { stage: "close" }),
  ];
  const reopened = (closureOutcomeId: string): ItemEvent => ({
    type: "reopened",
    seq: ++seq,
    closureOutcomeId,
  });
  const closureOf = (events: ReadonlyArray<ItemEvent>) => {
    const stage = nextStage(events);
    if (stage.type !== "done") throw new Error(`expected done, got ${stage.type}`);
    return stage.closureOutcomeId;
  };

  it("a reopen of the current closure starts a new version at its first build", () => {
    const events = closedLineage("r1");
    const closure = closureOf(events);
    events.push(reopened(closure));
    const stage = nextStage(events);
    assert.deepStrictEqual(stage, { type: "implement", reopenOf: closure });
    assert.strictEqual(stageBasis(stage as never), `implement:reopen:${closure}`);
  });

  it("the new version runs the ordinary lifecycle to its own closure", () => {
    const events = closedLineage("r2");
    const first = closureOf(events);
    events.push(reopened(first), ...closedLineage("r3"));
    const second = closureOf(events);
    assert.notStrictEqual(second, first);
    // A late record of the earlier reopen changes nothing: only the current closure reopens.
    events.push(reopened(first));
    assert.strictEqual(closureOf(events), second);
  });

  it("a reopen names a closure; one that is not the item's current closure is ignored", () => {
    const events = [...closedLineage("r4"), reopened("not-this-closure")];
    assert.strictEqual(nextStage(events).type, "done");
  });
});

describe("a rejected review result (BTC #106)", () => {
  const rejected = (outcomeId: string): ItemEvent => ({
    type: "rejected",
    seq: ++seq,
    outcomeId,
    failureDigest: `rejected:${outcomeId}`,
  });
  const lastOutcome = (events: ReadonlyArray<ItemEvent>) => {
    const event = events.at(-1);
    if (event?.type !== "outcome") throw new Error("expected an outcome");
    return event.outcomeId;
  };

  it("sends the head back to a fresh review, not to another correction", () => {
    const events: Array<ItemEvent> = [
      admitted("implement"),
      outcome("implemented", { head: "a1" }),
      admitted("review"),
      outcome("review_failed", { head: "a1", failureDigest: "circular" }),
    ];
    const failedReview = lastOutcome(events);
    events.push(
      admitted("correct"),
      outcome("failed", { stage: "correct", failureDigest: "needs-owner" }),
    );
    assert.strictEqual(nextStage(events).type, "correct");
    events.push(rejected(failedReview));
    const stage = nextStage(events);
    assert.deepStrictEqual(stage, {
      type: "review",
      outcomeId: (events[1] as Extract<ItemEvent, { type: "outcome" }>).outcomeId,
      head: "a1",
      again: failedReview,
    });
    assert.strictEqual(stageBasis(stage as never), `review:a1:again:${failedReview}`);
    // The fresh review's own verdict decides from there.
    events.push(admitted("review"), outcome("review_passed", { head: "a1" }));
    assert.strictEqual(nextStage(events).type, "integrate");
  });

  it("a withdrawn pass stops an integration that has not landed", () => {
    const events: Array<ItemEvent> = [
      admitted("implement"),
      outcome("implemented", { head: "b1" }),
      admitted("review"),
      outcome("review_passed", { head: "b1" }),
    ];
    const passed = lastOutcome(events);
    assert.strictEqual(nextStage(events).type, "integrate");
    events.push(rejected(passed));
    const stage = nextStage(events);
    assert.strictEqual(stage.type, "review");
    assert.strictEqual(stageBasis(stage as never), `review:b1:again:${passed}`);
  });

  it("a landed integration stays landed", () => {
    const events: Array<ItemEvent> = [
      admitted("implement"),
      outcome("implemented", { head: "c1" }),
      admitted("review"),
      outcome("review_passed", { head: "c1" }),
    ];
    const passed = lastOutcome(events);
    events.push(outcome("integrated", { stage: "integrate" }), rejected(passed));
    assert.strictEqual(nextStage(events).type, "close");
  });
});

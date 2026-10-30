import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { FactoryId, FactoryItemKey, ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { dependency, renderWait, uncertain, waitBasis } from "./factoryOperationWait.ts";
import * as FactoryOperationStore from "./FactoryOperationStore.ts";

const layer = FactoryOperationStore.layer.pipe(
  Layer.provideMerge(Layer.fresh(SqlitePersistence.layerMemory)),
  Layer.provideMerge(NodeServices.layer),
);

const refused = dependency({
  actor: "whoever controls push access to work on origin",
  action: "let this account create or fast-forward work",
  resume: "origin accepts the push",
  facts: ["publish_refused", "work", "a".repeat(40)],
});

it("Wait: who acts, the action and the resume condition survive any reason, without credentials", () => {
  const text = renderWait(
    `push to https://x-access-token:secret-token@example.invalid/repo.git refused\n${"detail ".repeat(200)}`,
    refused,
  );
  assert.notInclude(text, "secret-token");
  assert.include(text, "https://***@example.invalid");
  assert.notInclude(text, "\n");
  // FactoryLifecycle shows the first 500 characters of a waiting operation.
  const shown = text.slice(0, 500);
  for (const part of [
    "waiting",
    `who acts: ${refused.actor}`,
    `action: ${refused.action}`,
    `resumes when: ${refused.resume}`,
  ]) {
    assert.include(shown, part);
  }
  assert.include(
    renderWait("the merge was not confirmed", uncertain({ ...refused, facts: [] })),
    "uncertain write, read back before any resend",
  );
  // The basis is the facts and the kind, not the words.
  assert.strictEqual(waitBasis({ ...refused, actor: "someone else" }), waitBasis(refused));
  assert.notStrictEqual(waitBasis(uncertain(refused)), waitBasis(refused));
});

it.effect(
  "Wait: one basis is one wait from its first sighting; a new basis or the end replaces it",
  () =>
    Effect.gen(function* () {
      const operations = yield* FactoryOperationStore.FactoryOperationStore;
      const operationId = "integrate:wait";
      yield* operations.intend({
        operationId,
        factoryId: FactoryId.make("wait"),
        itemKey: FactoryItemKey.make("github:example-org/wait#1"),
        intent: {
          kind: "git_integrate",
          projectId: ProjectId.make("project:wait"),
          branch: "main",
          remote: "origin",
          expected: "b".repeat(40),
          reviewedHead: "a".repeat(40),
          mode: "merge",
          marker: "T3-Factory-Operation: integrate:wait",
          message: "Integrate",
          identity: { name: "T3", email: "t3@example.invalid" },
        },
      });
      const note = (wait = refused, reason = "refused") =>
        operations.noteWait({
          operationId,
          wait: {
            kind: wait.kind,
            basis: waitBasis(wait),
            actor: wait.actor,
            action: wait.action,
            resume: wait.resume,
          },
          text: renderWait(reason, wait),
        });
      const read = Effect.map(operations.get(operationId), Option.getOrThrow);
      assert.isTrue(yield* note());
      const first = yield* read;
      yield* TestClock.adjust("5 minutes");
      // The same wait read again writes nothing; reworded, it keeps its first sighting.
      assert.isFalse(yield* note());
      assert.deepStrictEqual(yield* read, first);
      assert.isTrue(yield* note(refused, "refused again, worded differently"));
      assert.strictEqual((yield* read).wait?.since, first.wait?.since);
      // Different facts are a different wait, from now.
      assert.isTrue(
        yield* note({ ...refused, facts: ["publish_refused", "work", "c".repeat(40)] }),
      );
      assert.notStrictEqual((yield* read).wait?.since, first.wait?.since);
      // An ended operation carries no wait.
      yield* operations.complete({
        operationId,
        completion: { state: "stale", reason: "target moved" },
      });
      const ended = yield* read;
      assert.isUndefined(ended.wait);
      assert.isUndefined(ended.lastError);
      assert.isFalse(yield* note());
    }).pipe(Effect.provide(layer)),
);

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
import { pullRequestStep } from "./factoryPullRequests.ts";

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

it("Wait: however long each part, the whole line fits the excerpt with every part in it", () => {
  const long = (label: string) => `${label} ${"x".repeat(400)}`;
  const text = renderWait(
    long("reason"),
    dependency({
      actor: long("the actor"),
      action: long("the action"),
      resume: long("the resume"),
      facts: [],
    }),
  );
  assert.isAtMost(text.length, 500);
  for (const part of [
    "reason x",
    "who acts: the actor x",
    "action: the action x",
    "resumes when: the resume x",
  ]) {
    assert.include(text, part);
  }
});

it("Wait: a credential in any part is redacted where the wait is made, its basis included", () => {
  const remote = (secret: string) => `https://x-access-token:${secret}@example.invalid/repo.git`;
  const made = (secret: string) =>
    dependency({
      actor: `whoever controls push access to work on ${remote(secret)}`,
      action: `create main on ${remote(secret)}`,
      resume: `main exists on ${remote(secret)}`,
      facts: ["base_missing", remote(secret)],
    });
  const wait = made("SYNTHETIC_ONLY");
  for (const text of [JSON.stringify(wait), renderWait("missing", wait)]) {
    assert.notInclude(text, "SYNTHETIC_ONLY");
    assert.include(text, "https://***@example.invalid/repo.git");
  }
  // A rotated credential is the same remote, so the same wait.
  assert.strictEqual(waitBasis(made("SYNTHETIC_ROTATED")), waitBasis(wait));
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

it.effect(
  "Wait: a draft made ready at the same head is a new wait on the reviewers, from then",
  () =>
    Effect.gen(function* () {
      const operations = yield* FactoryOperationStore.FactoryOperationStore;
      const operationId = "integrate:draft";
      const head = "a".repeat(40);
      yield* operations.intend({
        operationId,
        factoryId: FactoryId.make("wait"),
        itemKey: FactoryItemKey.make("github:example-org/wait#2"),
        intent: {
          kind: "pull_request_merge",
          projectId: ProjectId.make("project:wait"),
          repository: "example-org/wait",
          remote: "origin",
          base: "main",
          head: "work",
          reviewedHead: head,
          method: "merge",
          marker: "T3-Factory-Operation: integrate:draft",
          title: "Draft",
          body: "Refs #2",
        },
      });
      const pull = {
        number: 143,
        state: "open" as const,
        merged: false,
        mergeCommit: null,
        headSha: head,
        draft: true,
        nodeId: null,
        mergeableState: "blocked",
      };
      const note = (draft: boolean) => {
        const step = pullRequestStep({ ...pull, draft }, head, { pending: [], failed: [] });
        if (step.type !== "wait") return Effect.die(step);
        return operations.noteWait({
          operationId,
          wait: {
            kind: step.wait.kind,
            basis: waitBasis(step.wait),
            actor: step.wait.actor,
            action: step.wait.action,
            resume: step.wait.resume,
          },
          text: renderWait(step.reason, step.wait),
        });
      };
      const read = Effect.map(operations.get(operationId), Option.getOrThrow);
      yield* note(true);
      const drafted = yield* read;
      yield* TestClock.adjust("5 minutes");
      assert.isFalse(yield* note(true));
      assert.deepStrictEqual(yield* read, drafted);
      yield* note(false);
      const reviewing = yield* read;
      assert.notStrictEqual(reviewing.wait?.basis, drafted.wait?.basis);
      assert.notStrictEqual(reviewing.wait?.since, drafted.wait?.since);
      assert.strictEqual(reviewing.wait?.actor, "the repository's required reviewers");
    }).pipe(Effect.provide(layer)),
);

it.effect("Wait: a raw credential handed to the store is never written", () =>
  Effect.gen(function* () {
    const operations = yield* FactoryOperationStore.FactoryOperationStore;
    const operationId = "integrate:secret";
    const remote = "https://x-access-token:SYNTHETIC_ONLY@example.invalid/repo.git";
    yield* operations.intend({
      operationId,
      factoryId: FactoryId.make("wait"),
      itemKey: FactoryItemKey.make("github:example-org/wait#3"),
      intent: {
        kind: "git_integrate",
        projectId: ProjectId.make("project:wait"),
        branch: "main",
        remote: "origin",
        expected: "b".repeat(40),
        reviewedHead: "a".repeat(40),
        mode: "merge",
        marker: "T3-Factory-Operation: integrate:secret",
        message: "Integrate",
        identity: { name: "T3", email: "t3@example.invalid" },
      },
    });
    yield* operations.noteWait({
      operationId,
      wait: {
        kind: "dependency",
        basis: "basis",
        actor: `whoever controls ${remote}`,
        action: `create main on ${remote}`,
        resume: `main exists on ${remote}`,
      },
      text: `waiting on ${remote}`,
    });
    const stored = JSON.stringify(Option.getOrThrow(yield* operations.get(operationId)));
    assert.notInclude(stored, "SYNTHETIC_ONLY");
    assert.include(stored, "https://***@example.invalid/repo.git");
  }).pipe(Effect.provide(layer)),
);

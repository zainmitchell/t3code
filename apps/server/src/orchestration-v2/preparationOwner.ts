import { TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

/** Who asked for one workspace preparation: an owner can only ever account for its own. */
export const PreparationOwnerId = TrimmedNonEmptyString.pipe(Schema.brand("PreparationOwnerId"));
export type PreparationOwnerId = typeof PreparationOwnerId.Type;

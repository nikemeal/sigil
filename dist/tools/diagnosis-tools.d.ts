/**
 * Diagnosis Tools (Module 9)
 *
 * Scoped, validated tools for self-diagnosis and self-repair.
 * All writes go to local/src/ — upstream src/ is never modified.
 *
 * Tools:
 *   read_source     — read a Sigil source file with override status
 *   apply_patch     — write a patched file to local/src/ (compilation-gated)
 *   list_overrides  — inventory of active local overrides
 *   remove_override — clean up a local override
 */
import type { Tool } from '../types.js';
import type { EventBus } from '../lib/event-bus.js';
/** Creates diagnosis tools bound to an event bus */
export declare function createDiagnosisTools(bus: EventBus): Tool[];
//# sourceMappingURL=diagnosis-tools.d.ts.map
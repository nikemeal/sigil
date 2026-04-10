/**
 * Request Classifier
 *
 * Analyses incoming messages and classifies their complexity.
 * Used by the router to pick the right model.
 *
 * Classification tiers:
 *   - chat:     casual conversation, greetings, simple replies
 *   - question: factual questions, lookups
 *   - tool:     requests that need tools (commands, file ops, memory)
 *   - complex:  multi-step reasoning, code, analysis, planning
 *
 * Uses heuristics first (fast, free), with learned patterns applied when available.
 */
/** Request complexity type */
export type RequestType = 'chat' | 'question' | 'tool' | 'complex' | 'background';
/** Result of classification */
export interface Classification {
    type: RequestType;
    confidence: number;
    reason: string;
    override?: string;
}
/**
 * Classify a message using heuristics.
 * Returns the classification and strips any override prefix from the message.
 */
export declare function classify(message: string): {
    classification: Classification;
    cleanMessage: string;
};
//# sourceMappingURL=classifier.d.ts.map
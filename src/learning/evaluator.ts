/**
 * Evaluator
 *
 * Automatically extracts reusable techniques from completed background tasks.
 * Listens on task:complete, fires a cheap LLM call to extract a technique,
 * and stores it in the TechniqueStore.
 *
 * Uses the cheapest available model to keep costs minimal.
 * Silently skips if extraction fails or yields nothing useful.
 */

import type { CompletionRequest } from '../types.js';
import { EventBus } from '../lib/event-bus.js';
import { ProviderPool } from '../router/provider-pool.js';
import { TechniqueStore } from './store.js';

const EXTRACTION_PROMPT = `Given this task and result, extract ONE reusable technique as two fields:
- pattern: what kind of task this applies to (1 sentence)
- technique: the specific approach that worked (2-3 sentences)

Only extract something genuinely reusable. If nothing is worth keeping, reply: SKIP

Task: {task}
Result: {result}`;

export class Evaluator {
  constructor(
    private bus: EventBus,
    private pool: ProviderPool,
    private store: TechniqueStore,
  ) {
    this.bus.on('task:complete', ({ taskId, userMessage, result }) => {
      if (!result || result.trim().length === 0) return;
      void this.evaluate(taskId, userMessage, result);
    });
  }

  private async evaluate(taskId: string, userMessage: string, result: string): Promise<void> {
    const cheapest = this.pool.getCheapest();
    if (!cheapest) return;

    const prompt = EXTRACTION_PROMPT
      .replace('{task}', userMessage)
      .replace('{result}', result.slice(0, 500));

    try {
      const req: CompletionRequest = {
        messages: [{ role: 'user', content: prompt }],
        model: cheapest.model.model,
        maxTokens: 200,
        temperature: 0,
      };
      const response = await cheapest.provider.complete(req);
      const text = response.content.trim();

      if (!text || text === 'SKIP') return;

      const patternMatch = text.match(/^-?\s*pattern:\s*(.+?)$/im);
      const techniqueMatch = text.match(/^-?\s*technique:\s*([\s\S]+?)(?:\n-|\n\n|$)/im);
      if (!patternMatch || !techniqueMatch) return;

      const pattern = patternMatch[1].trim();
      const technique = techniqueMatch[1].trim();
      if (!pattern || !technique) return;

      const id = this.store.add(pattern, technique, undefined, 'auto');
      this.bus.emit('learning:technique_captured', { id, pattern, source: 'auto' });
    } catch (err) {
      console.warn(
        `[Evaluator] Technique extraction failed for task ${taskId.slice(0, 8)}:`,
        (err as Error).message,
      );
    }
  }
}

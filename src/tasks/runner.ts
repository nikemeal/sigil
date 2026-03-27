/**
 * Task Runner
 *
 * Executes a task's steps sequentially. Each step is routed to its
 * assigned model, with context built from the task description and
 * previous step results. Emits events throughout for transport
 * notifications.
 */

import type { SigilConfig, ModelConfig, Task, TaskStep } from '../types.js';
import { EventBus } from '../lib/event-bus.js';
import { ProviderPool } from '../router/provider-pool.js';
import { ContextEngine } from '../context/engine.js';
import { ToolRegistry } from '../tools/registry.js';
import { CostTracker } from '../router/cost-tracker.js';
import { TaskStore } from './store.js';
import { Planner } from './planner.js';

export class TaskRunner {
  private bus: EventBus;
  private pool: ProviderPool;
  private context: ContextEngine;
  private tools: ToolRegistry | null;
  private costTracker: CostTracker | null;
  private store: TaskStore;
  private planner: Planner;
  private config: SigilConfig;

  constructor(
    bus: EventBus,
    pool: ProviderPool,
    context: ContextEngine,
    tools: ToolRegistry | null,
    costTracker: CostTracker | null,
    store: TaskStore,
    planner: Planner,
    config: SigilConfig,
  ) {
    this.bus = bus;
    this.pool = pool;
    this.context = context;
    this.tools = tools;
    this.costTracker = costTracker;
    this.store = store;
    this.planner = planner;
    this.config = config;
  }

  /** Execute a task: plan steps, run each, collect results */
  async run(task: Task): Promise<void> {
    console.log(`[TaskRunner] Starting task ${task.id.slice(0, 8)}: "${task.userMessage.slice(0, 60)}"`);

    this.store.updateStatus(task.id, 'running');
    this.bus.emit('task:started', { taskId: task.id });

    try {
      // Plan the task into steps
      const plannedSteps = await this.planner.plan(task.userMessage);
      console.log(`[TaskRunner] Planned ${plannedSteps.length} step(s)`);

      // Create steps in the store and resolve models
      const steps: TaskStep[] = [];
      for (let i = 0; i < plannedSteps.length; i++) {
        const planned = plannedSteps[i];
        const model = this.resolveModel(planned.tier);
        const step = this.store.addStep(
          task.id, i + 1, planned.description, model.name, model.tier,
        );
        steps.push(step);
      }

      // Execute each step sequentially
      const results: string[] = [];
      for (const step of steps) {
        try {
          const result = await this.executeStep(task, step, results, steps.length);
          results.push(result);
        } catch (stepErr) {
          this.store.failStep(step.id, stepErr instanceof Error ? stepErr.message : String(stepErr));
          throw stepErr;
        }
      }

      // Compose final result
      const finalResult = results.length === 1
        ? results[0]
        : results.map((r, i) => `**Step ${i + 1}:**\n${r}`).join('\n\n');

      // Update task
      this.store.setResult(task.id, finalResult);
      this.store.updateTotals(task.id);
      this.store.updateStatus(task.id, 'complete');

      const updated = this.store.get(task.id)!;
      console.log(`[TaskRunner] Task ${task.id.slice(0, 8)} complete. Cost: $${updated.totalCost.toFixed(4)}`);

      this.bus.emit('task:complete', {
        taskId: task.id,
        userMessage: task.userMessage,
        result: finalResult,
        cost: updated.totalCost,
      });

    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[TaskRunner] Task ${task.id.slice(0, 8)} failed: ${error}`);

      this.store.updateStatus(task.id, 'error');
      this.store.setResult(task.id, `Error: ${error}`);
      this.bus.emit('task:error', { taskId: task.id, error });
    }
  }

  /** Execute a single step */
  private async executeStep(task: Task, step: TaskStep, previousResults: string[], totalSteps: number): Promise<string> {
    console.log(`[TaskRunner] Step ${step.stepNumber}: ${step.description.slice(0, 60)} → ${step.assignedModel}`);
    this.store.startStep(step.id);

    const model = this.config.models.find((m) => m.name === step.assignedModel);
    if (!model) throw new Error(`Model '${step.assignedModel}' not found`);

    const provider = this.pool.getProvider(model);

    // Build context for this step
    const systemPrompt = this.buildStepPrompt(task, step, previousResults, totalSteps);
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: step.description },
    ];

    const completion = await provider.complete({
      model: model.model,
      messages,
      maxTokens: 4096,
    });

    const cost = (completion.usage.inputTokens / 1000) * model.costPer1kInput
               + (completion.usage.outputTokens / 1000) * model.costPer1kOutput;

    // Record step completion
    this.store.completeStep(
      step.id, completion.content,
      completion.usage.inputTokens, completion.usage.outputTokens, cost,
    );

    // Track cost in main usage table too
    if (this.costTracker) {
      this.costTracker.log(
        task.id, model, completion.usage,
        'background', 'orchestrated', null,
      );
    }

    const completedStep: TaskStep = {
      ...step,
      status: 'complete',
      result: completion.content,
      inputTokens: completion.usage.inputTokens,
      outputTokens: completion.usage.outputTokens,
      cost,
    };
    this.bus.emit('task:step_complete', { taskId: task.id, step: completedStep });

    console.log(`[TaskRunner] Step ${step.stepNumber} done (${completion.usage.inputTokens + completion.usage.outputTokens} tokens, $${cost.toFixed(4)})`);

    return completion.content;
  }

  /** Build a system prompt for a task step */
  private buildStepPrompt(task: Task, step: TaskStep, previousResults: string[], totalSteps: number): string {
    const identity = this.config.identity;
    let prompt = `You are ${identity.name}. ${identity.personality}\n\n`;
    prompt += `You are working on a background task. The user's original request was:\n"${task.userMessage}"\n\n`;

    if (previousResults.length > 0) {
      prompt += `Previous steps completed:\n`;
      for (let i = 0; i < previousResults.length; i++) {
        // Keep previous results concise — truncate long ones
        const result = previousResults[i].length > 2000
          ? previousResults[i].slice(0, 2000) + '\n[truncated]'
          : previousResults[i];
        prompt += `\nStep ${i + 1} result:\n${result}\n`;
      }
      prompt += '\n';
    }

    prompt += `Your current task is step ${step.stepNumber}. Complete it thoroughly and concisely.`;

    // Final step: tell the LLM to reference the original request naturally
    if (step.stepNumber === totalSteps) {
      prompt += `\n\nIMPORTANT: This result will be sent directly to the user as a follow-up message. `;
      prompt += `Start by briefly referencing what they asked about (e.g. "You asked about X — here's what I found"). `;
      prompt += `Do NOT mention tasks, steps, or background processing. Just deliver the answer naturally.`;
    }

    return prompt;
  }

  /** Find the best available model for a given tier */
  private resolveModel(tier: string): ModelConfig {
    const models = this.config.models;

    // Exact tier match
    const match = models.find((m) => m.tier === tier);
    if (match) return match;

    // Fallback: default model or first available
    const defaultModel = models.find((m) => m.name === this.config.defaultModel);
    return defaultModel ?? models[0];
  }
}

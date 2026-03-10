import type { LLMProvider, Transport } from '../gateway/types.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { ContextEngine } from '../context/engine.js';
import type { TaskStore, Task, TaskStep } from './store.js';
import { randomUUID } from 'node:crypto';

type NotifyFn = (transport: Transport, threadId: string | undefined, message: string) => Promise<void>;

/**
 * TaskRunner executes tasks autonomously in the background.
 *
 * Flow:
 * 1. User says "research X and write me a summary"
 * 2. Agent creates a Task with planned steps
 * 3. Agent responds "Got it, I'll work on this and message you when done"
 * 4. TaskRunner picks up the task and executes steps sequentially
 * 5. Each step: call LLM with task context + working memory → execute tools → store results
 * 6. On completion: notify user via their preferred transport
 * 7. On failure: retry or notify user of the problem
 */
export class TaskRunner {
  private llm: LLMProvider;
  private tools: ToolRegistry;
  private context: ContextEngine;
  private store: TaskStore;
  private notify: NotifyFn;
  private running = new Set<string>();

  constructor(
    llm: LLMProvider,
    tools: ToolRegistry,
    context: ContextEngine,
    store: TaskStore,
    notify: NotifyFn,
  ) {
    this.llm = llm;
    this.tools = tools;
    this.context = context;
    this.store = store;
    this.notify = notify;
  }

  /** Execute a task — called by the scheduler or immediately after creation */
  async execute(taskId: string): Promise<void> {
    if (this.running.has(taskId)) return; // Already running
    this.running.add(taskId);

    const task = this.store.get(taskId);
    if (!task || task.status === 'completed' || task.status === 'cancelled') {
      this.running.delete(taskId);
      return;
    }

    console.log(`[task-runner] Starting task ${task.id.slice(0, 8)}: ${task.objective.slice(0, 60)}`);
    this.store.update(task.id, { status: 'running' });

    try {
      // If no steps planned yet, ask the LLM to plan them
      if (task.steps.length === 0) {
        await this.planTask(task);
      }

      // Execute remaining steps
      while (task.currentStep < task.steps.length) {
        const step = task.steps[task.currentStep];
        await this.executeStep(task, step);

        // Check if the step decided to add more steps or reschedule
        const refreshed = this.store.get(task.id);
        if (!refreshed || refreshed.status === 'waiting' || refreshed.status === 'cancelled') {
          this.running.delete(taskId);
          return;
        }

        // Update local reference
        Object.assign(task, refreshed);
      }

      // All steps complete
      this.store.update(task.id, {
        status: 'completed',
        completedAt: new Date().toISOString(),
      });

      // Generate final summary and notify
      const summary = await this.generateSummary(task);
      await this.notify(
        task.replyTransport,
        task.replyThreadId,
        summary,
      );

      console.log(`[task-runner] Completed task ${task.id.slice(0, 8)}`);

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[task-runner] Task ${task.id.slice(0, 8)} failed: ${message}`);

      if (task.retryCount < task.maxRetries) {
        // Retry with backoff
        const backoffMs = Math.pow(2, task.retryCount) * 60_000; // 1min, 2min, 4min...
        const runAt = new Date(Date.now() + backoffMs).toISOString();
        this.store.update(task.id, {
          status: 'waiting',
          retryCount: task.retryCount + 1,
          runAt,
        });
        console.log(`[task-runner] Will retry task ${task.id.slice(0, 8)} at ${runAt}`);
      } else {
        this.store.update(task.id, { status: 'failed' });
        await this.notify(
          task.replyTransport,
          task.replyThreadId,
          `I wasn't able to complete the task: "${task.objective}"\n\nError: ${message}\n\nI tried ${task.retryCount + 1} time(s). Let me know if you'd like me to try a different approach.`,
        );
      }
    } finally {
      this.running.delete(taskId);
    }
  }

  /** Ask the LLM to break a task into steps */
  private async planTask(task: Task): Promise<void> {
    const response = await this.llm.complete({
      system: `You are a task planner. Break the following objective into concrete, executable steps.
Each step should be a single action you can complete with the tools available.
Respond with ONLY a JSON array of step descriptions, no other text.

Available tools: ${this.tools.list().join(', ')}

Example response:
["Search the web for recent articles about X", "Read and summarise the top 3 results", "Write a summary document", "Save the document to disk"]`,
      messages: [{ role: 'user', content: task.objective }],
    });

    let stepDescriptions: string[];
    try {
      // Try to parse JSON from the response
      const cleaned = response.content.replace(/```json\s*|\s*```/g, '').trim();
      stepDescriptions = JSON.parse(cleaned);
    } catch {
      // If parsing fails, split by newlines and treat as steps
      stepDescriptions = response.content
        .split('\n')
        .map(l => l.replace(/^\d+\.\s*/, '').replace(/^-\s*/, '').trim())
        .filter(l => l.length > 5);
    }

    if (stepDescriptions.length === 0) {
      stepDescriptions = [task.objective]; // Fall back to single step
    }

    const steps: TaskStep[] = stepDescriptions.map(desc => ({
      id: randomUUID(),
      description: desc,
      status: 'pending',
    }));

    task.steps = steps;
    this.store.update(task.id, { steps });
    console.log(`[task-runner] Planned ${steps.length} steps for task ${task.id.slice(0, 8)}`);
  }

  /** Execute a single step of a task */
  private async executeStep(task: Task, step: TaskStep): Promise<void> {
    step.status = 'running';
    step.startedAt = new Date().toISOString();
    this.store.update(task.id, { steps: task.steps });

    const response = await this.llm.complete({
      system: `You are executing a step in a larger task. Use tools as needed to complete this step.

TASK OBJECTIVE: ${task.objective}

STEPS PLANNED:
${task.steps.map((s, i) => `${i + 1}. [${s.status}] ${s.description}`).join('\n')}

CURRENT STEP: ${task.currentStep + 1}. ${step.description}

WORKING MEMORY (context from previous steps):
${task.workingMemory || '(none yet)'}

Complete the current step. After using tools, summarise what you accomplished.
If this step reveals that additional steps are needed, say so.
If this task should wait for something (e.g., wait until tomorrow, check back later),
respond with WAIT_UNTIL: <ISO datetime> and explain why.`,
      messages: [{ role: 'user', content: `Execute step: ${step.description}` }],
      tools: this.tools.getSchemas(),
    });

    // Handle tool calls in a loop
    let content = response.content;
    let completion = response;
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: `Execute step: ${step.description}` },
    ];

    let toolRounds = 0;
    while (completion.toolCalls?.length && toolRounds < 8) {
      toolRounds++;
      const results: string[] = [];

      for (const tc of completion.toolCalls) {
        const result = await this.tools.execute(tc.name, tc.input);
        results.push(`[${tc.name}]: ${result.content}`);
      }

      messages.push({ role: 'assistant', content: content || '(executing tools)' });
      messages.push({ role: 'user', content: `Tool results:\n${results.join('\n\n')}` });

      completion = await this.llm.complete({
        system: `Continue executing the task step. Summarise progress.`,
        messages,
        tools: this.tools.getSchemas(),
      });

      content = completion.content;
    }

    // Check for WAIT_UNTIL directive
    const waitMatch = content.match(/WAIT_UNTIL:\s*(\S+)/);
    if (waitMatch) {
      const runAt = waitMatch[1];
      step.status = 'waiting' as TaskStep['status'];
      step.result = content;
      this.store.update(task.id, {
        status: 'waiting',
        steps: task.steps,
        workingMemory: task.workingMemory + `\n\n--- Step ${task.currentStep + 1} ---\n${content}`,
        runAt,
      });
      return;
    }

    // Step complete — update working memory and advance
    step.status = 'completed';
    step.result = content;
    step.completedAt = new Date().toISOString();

    task.currentStep++;
    task.workingMemory += `\n\n--- Step ${task.currentStep} ---\n${content}`;

    this.store.update(task.id, {
      steps: task.steps,
      currentStep: task.currentStep,
      workingMemory: task.workingMemory,
    });
  }

  /** Generate a final summary when all steps are done */
  private async generateSummary(task: Task): Promise<string> {
    const response = await this.llm.complete({
      system: `Summarise the completed task for the user. Be concise and direct. Include key findings or outputs.`,
      messages: [{
        role: 'user',
        content: `Task completed: "${task.objective}"\n\nWorking memory:\n${task.workingMemory}`,
      }],
    });

    return response.content;
  }
}

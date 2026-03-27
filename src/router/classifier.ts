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
  confidence: number;    // 0-1, how confident the classifier is
  reason: string;        // human-readable explanation
  override?: string;     // user override detected (/local, /cloud, /private)
}

/** Keywords/patterns that indicate different request types */
const TOOL_INDICATORS = [
  'run', 'execute', 'command', 'shell', 'terminal',
  'read file', 'show file', 'write file', 'create file', 'save',
  'list dir', 'list files', 'what files', 'show me the',
  'remember', 'recall', 'update profile', 'update my profile',
  'uptime', 'disk space', 'disk usage', 'how much space',
  'install', 'restart', 'status of',
  'working on', 'background task', 'task status', 'any tasks',
  'health', 'system status', 'diagnostics',
  'patch', 'override', 'source code', 'read source',
  'self repair', 'self-repair', 'diagnose', 'fix this',
];

const COMPLEX_INDICATORS = [
  'explain', 'analyse', 'analyze', 'compare', 'evaluate',
  'write code', 'build', 'create a', 'design', 'architect',
  'review', 'refactor', 'debug', 'why does',
  'step by step', 'in detail', 'comprehensive',
  'plan', 'strategy', 'how would you', 'what approach',
  'summarise', 'summarize', 'essay', 'article', 'report',
];

const CHAT_INDICATORS = [
  'hi', 'hello', 'hey', 'thanks', 'thank you', 'ok', 'okay',
  'good', 'great', 'nice', 'cool', 'sure', 'yes', 'no',
  'bye', 'goodbye', 'lol', 'haha',
];

const BACKGROUND_INDICATORS = [
  'research', 'look into', 'find out', 'get back to me',
  'when you have time', 'in the background', 'dig into',
  'investigate', 'deep dive', 'thorough',
];

/** Override prefixes that users can type */
const OVERRIDES: Record<string, string> = {
  '/local': 'local',
  '/cloud': 'cloud',
  '/private': 'private',
  '/bg': 'background',
};

/**
 * Classify a message using heuristics.
 * Returns the classification and strips any override prefix from the message.
 */
export function classify(message: string): { classification: Classification; cleanMessage: string } {
  let cleanMessage = message.trim();
  let override: string | undefined;

  // Check for override prefix
  for (const [prefix, name] of Object.entries(OVERRIDES)) {
    if (cleanMessage.toLowerCase().startsWith(prefix)) {
      override = name;
      cleanMessage = cleanMessage.slice(prefix.length).trim();
      break;
    }
  }

  const lower = cleanMessage.toLowerCase();
  const wordCount = cleanMessage.split(/\s+/).length;

  // Very short messages are usually chat
  if (wordCount <= 3) {
    const isChatWord = CHAT_INDICATORS.some((w) => lower === w || lower === w + '!');
    if (isChatWord) {
      return {
        classification: { type: 'chat', confidence: 0.9, reason: 'Short greeting/response', override },
        cleanMessage,
      };
    }
  }

  // Check for background task indicators
  if (override === 'background') {
    return {
      classification: { type: 'background', confidence: 0.95, reason: 'Override: /bg', override: 'background' },
      cleanMessage,
    };
  }
  const bgMatch = BACKGROUND_INDICATORS.find((t) => lower.includes(t));
  if (bgMatch && wordCount > 8) {
    return {
      classification: { type: 'background', confidence: 0.7, reason: `Background indicator: "${bgMatch}"`, override },
      cleanMessage,
    };
  }

  // Check for tool indicators
  const toolMatch = TOOL_INDICATORS.find((t) => lower.includes(t));
  if (toolMatch) {
    return {
      classification: { type: 'tool', confidence: 0.8, reason: `Tool indicator: "${toolMatch}"`, override },
      cleanMessage,
    };
  }

  // Check for complex indicators
  const complexMatch = COMPLEX_INDICATORS.find((t) => lower.includes(t));
  if (complexMatch) {
    return {
      classification: { type: 'complex', confidence: 0.7, reason: `Complex indicator: "${complexMatch}"`, override },
      cleanMessage,
    };
  }

  // Questions (ends with ?)
  if (cleanMessage.endsWith('?')) {
    return {
      classification: { type: 'question', confidence: 0.7, reason: 'Question mark detected', override },
      cleanMessage,
    };
  }

  // Long messages are more likely complex
  if (wordCount > 50) {
    return {
      classification: { type: 'complex', confidence: 0.6, reason: 'Long message', override },
      cleanMessage,
    };
  }

  // Medium messages default to question
  if (wordCount > 10) {
    return {
      classification: { type: 'question', confidence: 0.5, reason: 'Medium length, defaulting to question', override },
      cleanMessage,
    };
  }

  // Default: chat
  return {
    classification: { type: 'chat', confidence: 0.5, reason: 'Default classification', override },
    cleanMessage,
  };
}

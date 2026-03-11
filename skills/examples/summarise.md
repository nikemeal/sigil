# Summarise

Use this skill when asked to summarise articles, documents, long messages,
threads, or any large body of text.

## Approach

1. **Read the full content first** — don't summarise from the first few paragraphs.
   If given a URL, fetch it. If given a file, read it completely.
2. **Identify the core argument or purpose** — what is this actually about?
   Strip away filler, repetition, and tangential points.
3. **Extract actionable items** — if there are decisions needed, deadlines,
   or follow-ups, pull them out separately.
4. **Preserve important details** — names, dates, numbers, and specific
   claims should survive the summary. Don't generalise away the useful bits.

## Output format

Structure every summary with these sections:

- **TLDR** — one sentence, max two. The absolute core of it.
- **Key points** — 3-5 bullet points covering the main substance.
  Each point should stand on its own without needing the others.
- **Action items** — any tasks, decisions, or follow-ups identified.
  Skip this section if there aren't any.
- **Notable details** — specific data points, quotes, or facts worth
  keeping. Skip if the content is straightforward.

## Tone

Match the tone of the source material. A technical RFC gets a technical
summary. A casual blog post gets a casual summary. Don't over-formalise.

## Length guidelines

- Short article (< 1000 words): TLDR + 3 key points
- Medium content (1000-5000 words): full format
- Long document (5000+ words): full format, consider section-by-section
  breakdown if the document covers multiple distinct topics

import { z } from 'zod';

// Three variants are generated so the model picks its own strongest hook, which
// beats asking for one and hoping.
export const voiceoverSchema = z.object({
  variants: z.array(z.object({ text: z.string() })),
  bestIndex: z.number().int()
});

export const characterSpecSchema = z.object({
  character: z.string(),
  style: z.string()
});

export const imagePromptSchema = z.object({
  headline: z.string(),
  prompts: z.array(z.string())
});

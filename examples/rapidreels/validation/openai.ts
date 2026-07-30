import { z } from 'zod';

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

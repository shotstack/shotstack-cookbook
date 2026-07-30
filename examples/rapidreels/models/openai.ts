import { z } from 'zod';
import {
  voiceoverSchema,
  characterSpecSchema,
  imagePromptSchema
} from '@validation/openai';

export type VoiceoverVariants = z.infer<typeof voiceoverSchema>;
export type CharacterSpec = z.infer<typeof characterSpecSchema>;
export type ImagePrompt = z.infer<typeof imagePromptSchema>;

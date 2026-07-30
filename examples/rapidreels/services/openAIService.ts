import OpenAI from 'openai';
import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';

import {
  storyPrompts,
  voiceoverSystem,
  characterSpecSystem,
  imagePromptSystem,
  buildVoiceoverInstructions,
  buildCharacterSpecInstructions,
  buildImagePromptInstructions
} from '@constants/prompts';
import {
  voiceoverSchema,
  characterSpecSchema,
  imagePromptSchema
} from '@validation/openai';
import { CharacterSpec, ImagePrompt } from '@models/openai';

const DEFAULT_MODEL = 'gpt-5.4-mini';

let client: OpenAI | undefined;
const openai = () => (client ??= new OpenAI());

const model = () => process.env.OPENAI_MODEL || DEFAULT_MODEL;

async function chatJson<T extends z.ZodTypeAny>({
  system,
  user,
  schema,
  schemaName,
  maxTokens
}: {
  system: string;
  user: string;
  schema: T;
  schemaName: string;
  maxTokens: number;
}): Promise<z.infer<T>> {
  const completion = await openai().chat.completions.create({
    model: model(),
    max_completion_tokens: maxTokens,
    response_format: zodResponseFormat(schema, schemaName),
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]
  });

  const choice = completion.choices[0];
  if (choice?.finish_reason === 'length') {
    throw new Error(
      `${schemaName} response was truncated, increase max_completion_tokens`
    );
  }
  if (!choice?.message?.content) {
    throw new Error(`${schemaName} response was empty`);
  }

  return schema.parse(JSON.parse(choice.message.content));
}

export const generateVoiceover = async (content: string): Promise<string> => {
  console.info('Start voiceover script generation ...');

  const storyPrompt = storyPrompts[content as keyof typeof storyPrompts];
  if (!storyPrompt) throw new Error(`Unknown content type: ${content}`);

  const { variants, bestIndex } = await chatJson({
    system: voiceoverSystem,
    user: buildVoiceoverInstructions(storyPrompt),
    schema: voiceoverSchema,
    schemaName: 'voiceover_variants',
    maxTokens: 4000
  });

  const usable = variants.filter(variant => variant.text.trim());
  if (usable.length === 0) throw new Error('No usable voiceover variants');

  const index = Math.min(Math.max(bestIndex, 0), usable.length - 1);
  return usable[index].text.trim();
};

export const generateCharacterSpec = async (
  voiceover: string
): Promise<CharacterSpec> => {
  console.info('Start character spec generation ...');

  const spec = await chatJson({
    system: characterSpecSystem,
    user: buildCharacterSpecInstructions(voiceover),
    schema: characterSpecSchema,
    schemaName: 'character_spec',
    maxTokens: 2000
  });

  if (!spec.character.trim() || !spec.style.trim()) {
    throw new Error('Character spec is missing character or style');
  }
  return spec;
};

export const generateImagePrompts = async (
  voiceover: string,
  spec: CharacterSpec
): Promise<ImagePrompt> => {
  console.info('Start image prompts generation ...');

  const { headline, prompts } = await chatJson({
    system: imagePromptSystem,
    user: buildImagePromptInstructions(voiceover, spec.character, spec.style),
    schema: imagePromptSchema,
    schemaName: 'image_prompts',
    maxTokens: 8000
  });

  const usable = prompts.filter(prompt => prompt.trim());
  if (!headline.trim() || usable.length < 6) {
    throw new Error(
      `Expected a headline and 6 image prompts, got ${usable.length} prompts`
    );
  }

  return { headline: headline.trim(), prompts: usable.slice(0, 6) };
};

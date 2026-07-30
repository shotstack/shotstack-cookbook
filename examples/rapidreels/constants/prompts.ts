export const storyPrompts = {
  'Scary Story':
    'Write a 30-second scary story voiceover (70–80 words at ~150 wpm — must fill the full 30 seconds). Open with ≤8 words: a curiosity gap or sensory cold-open ("At 3:13 AM I heard scratching"). Three beats: hook (0–3s), confrontation (3–25s), resolution (25–30s). Present tense, short clauses, sixth-grade reading level. Concrete sensory detail — sound, texture, temperature. End on a gut-punch image.',
  'Bedtime Story':
    'Write a 30-second bedtime story voiceover (70–80 words at ~150 wpm — must fill the full 30 seconds). Open with a soft sensory line ("Under the moonlit meadow, a sleepy bunny stirred"). Gentle verbs, rhythmic cadence, warm colour words. Three beats: hush (0–5s), gentle adventure (5–25s), safe resting (25–30s). Sixth-grade reading level. End on a peaceful image.',
  Adventure:
    'Write a 30-second adventure voiceover (70–80 words at ~150 wpm — must fill the full 30 seconds). Open with ≤8 words: a bold claim or question ("Only one person has ever crossed this"). Active verbs, scale words, forward momentum. Three beats: stakes (0–5s), the leap (5–25s), mid-discovery (25–30s). Sixth-grade reading level. End mid-victory or mid-discovery.'
};

export const voiceoverSystem =
  'You are a voiceover writer for short-form social media video. You write tight, speakable narrator copy under tight word budgets, optimised so the first three seconds hook the viewer. Output is read verbatim by a TTS narrator — never include stage directions, speaker labels, parentheticals, or descriptive meta language. Just the spoken text.';

export const characterSpecSystem =
  'You are a visual director. Given a short voiceover script, you write a tight character spec sheet and a matching art-style spec — the canonical visual identity that will be reused verbatim across every shot of the resulting video. Anchor the model to one consistent look, no drift between scenes.';

export const imagePromptSystem =
  'You are a visual director writing image prompts for the Flux text-to-image model. Always return exactly the requested number of prompts as flowing natural prose, never as keyword lists. Front-load the subject and action of each shot. Reuse the provided character and style specs verbatim at the end of every prompt to anchor the model to one consistent visual identity across the whole sequence.';

export const buildVoiceoverInstructions = (storyPrompt: string) =>
  `${storyPrompt}\n\nGenerate exactly 3 distinct variants of this voiceover. Each must follow all the rules above. Then set bestIndex to the variant with the strongest hook and tightest delivery.`;

export const buildCharacterSpecInstructions = (voiceover: string) =>
  `Voiceover: "${voiceover}"\n\nProduce a tight CHARACTER spec (~25 words: one or two sentences capturing the protagonist's defining visual identity — appearance, clothing, expression) and a tight STYLE spec (~20 words: one sentence capturing medium, lighting, mood, composition). The character must fit the voiceover's tone. The style must be a single coherent look — never mix photorealistic with painterly. Keep both short enough to repeat verbatim in every shot without crowding the moment description.`;

export const buildImagePromptInstructions = (
  voiceover: string,
  character: string,
  style: string
) =>
  `Voiceover (30 seconds, 6 beats of ~5s each):\n"${voiceover}"\n\nCHARACTER (paste verbatim at the end of every prompt — keeps the character consistent):\n${character}\n\nSTYLE (paste verbatim at the end of every prompt — keeps the look consistent):\n${style}\n\nWrite exactly 6 image prompts. CRITICAL: each prompt MUST clearly depict what happens at THAT beat of the voiceover — the succession of 6 images, viewed in order, should tell the same story as the voiceover. Map beats to time: beat 1 ≈ 0–5s, beat 2 ≈ 5–10s, beat 3 ≈ 10–15s, beat 4 ≈ 15–20s, beat 5 ≈ 20–25s, beat 6 ≈ 25–30s.\n\nFor each prompt: 30–50 words of moment-specific prose, front-loaded with the subject and action of that beat (e.g. "She crouches beside the well, peering into the dark water"). Then append the CHARACTER spec, then the STYLE spec, verbatim. Total ~70–90 words per prompt.\n\nAlso produce a 3-word headline summarising the sequence.`;

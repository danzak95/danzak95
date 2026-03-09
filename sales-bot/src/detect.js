import Anthropic from '@anthropic-ai/sdk';
import { formatTranscriptsForPrompt } from './ingest.js';

const client = new Anthropic();

const SYSTEM_PROMPT = `You are a sales intelligence assistant for a Ramp sales rep. You analyze call transcripts to determine deal stage, evaluate decision tree gates, identify blockers, and generate pre-call briefs. Be direct, specific, and actionable. Reference actual transcript evidence when making assessments. Never hallucinate details not present in the transcripts.`;

const STAGE_DEFINITIONS = `
PIPELINE STAGES:
1. Discovery        - Confirm pain and timeline
2. Qualification    - Map decision makers and procurement process
3. Technical Validation - Confirm Ramp solves the pain and is vendor of choice
4. Mutual Action Plan - Align on timeline and shared close plan
5. Commercial Agreement - Application submitted, terms agreed
6. Execution        - All stakeholders in, target date locked, order form signed
`;

/**
 * Use Claude to detect the current pipeline stage from transcript history.
 * Returns { stage, confidence, reasoning, evidence }
 */
export async function detectStage(transcripts) {
  const transcriptText = formatTranscriptsForPrompt(transcripts);

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2048,
    thinking: { type: 'adaptive' },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Analyze these sales call transcripts and determine the current pipeline stage.

${STAGE_DEFINITIONS}

Evaluate the stage based on what has been CONFIRMED in the transcripts, not what has been discussed. The deal is in the highest stage where the prior stage's criteria are substantially met.

Return a JSON object with this exact structure:
{
  "stage": <number 1-6>,
  "confidence": <number 0.0-1.0>,
  "reasoning": "brief explanation of why this stage",
  "evidence": ["specific quotes or facts from transcript supporting this stage"],
  "prior_stage_gaps": ["any incomplete items from prior stages that still need addressing"]
}

Return valid JSON only, no markdown.

TRANSCRIPT HISTORY:
${transcriptText}`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('No text response from Claude during stage detection');

  try {
    return JSON.parse(textBlock.text);
  } catch {
    const match = textBlock.text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Failed to parse stage detection JSON from Claude response');
  }
}

/**
 * Display stage name from number.
 */
export function stageName(stageNum) {
  const stages = {
    1: 'Discovery',
    2: 'Qualification',
    3: 'Technical Validation',
    4: 'Mutual Action Plan',
    5: 'Commercial Agreement',
    6: 'Execution',
  };
  return stages[stageNum] || `Stage ${stageNum}`;
}

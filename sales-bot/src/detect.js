import Anthropic from '@anthropic-ai/sdk';
import { formatTranscriptsForPrompt } from './ingest.js';

const MOCK_MODE = process.env.MOCK_MODE === 'true';
const client = MOCK_MODE ? null : new Anthropic();

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
  if (MOCK_MODE) {
    return {
      stage: 2,
      confidence: 0.88,
      reasoning:
        'Discovery criteria are fully met: pain is clearly articulated (visibility gaps, out-of-policy spend, 15hrs/week reconciliation), urgency is confirmed (Q1 board commitment, headcount scaling), and timeline is established. The deal has moved into Qualification: economic buyer (Marcus Chen, CFO) is identified, champion (Sarah Park, VP Finance) is established, procurement process is understood (2-3 week eval → legal → CFO sign-off), and budget is acknowledged (~$80k earmarked). NetSuite/SSO technical validation has not yet occurred, so Stage 3 is not yet reached.',
      evidence: [
        'Marcus Chen (CFO) confirmed as decision authority: "I\'m the one who signs off"',
        'Sarah Park identified as champion running day-to-day evaluation',
        'Procurement process documented: 2-3 week eval, legal review, CFO approval',
        'Budget acknowledged: "$80,000 earmarked for the year for software tools"',
        'Pain articulated: 15hrs/week reconciliation, 3 out-of-policy incidents last quarter',
        'Timeline confirmed: Q1 board commitment, scaling to 350 employees by year-end',
      ],
      prior_stage_gaps: [
        'David Kim (Head of IT) has not yet been introduced — stakeholder map incomplete',
        'Internal agreement across all stakeholders not yet confirmed (David Kim not on call)',
      ],
    };
  }

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

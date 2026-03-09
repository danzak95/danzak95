import Anthropic from '@anthropic-ai/sdk';
import path from 'path';

const MOCK_MODE = process.env.MOCK_MODE === 'true';
const client = MOCK_MODE ? null : new Anthropic();

const SYSTEM_PROMPT = `You are a sales intelligence assistant for a Ramp sales rep. You analyze call transcripts to determine deal stage, evaluate decision tree gates, identify blockers, and generate pre-call briefs. Be direct, specific, and actionable. Reference actual transcript evidence when making assessments. Never hallucinate details not present in the transcripts.`;

/**
 * Parse raw transcript text into structured speaker turns.
 * Returns an array of { speaker, text } objects.
 */
export function parseTranscriptTurns(rawText) {
  const turns = [];
  const lines = rawText.split('\n');

  let currentSpeaker = null;
  let currentLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Match "Speaker Name: text" pattern
    const speakerMatch = trimmed.match(/^([^:]{1,50}):\s+(.+)$/);
    if (speakerMatch) {
      // Save previous turn
      if (currentSpeaker && currentLines.length) {
        turns.push({ speaker: currentSpeaker, text: currentLines.join(' ') });
      }
      currentSpeaker = speakerMatch[1].trim();
      currentLines = [speakerMatch[2].trim()];
    } else if (currentSpeaker) {
      // Continuation of current speaker's turn
      currentLines.push(trimmed);
    }
  }

  // Save last turn
  if (currentSpeaker && currentLines.length) {
    turns.push({ speaker: currentSpeaker, text: currentLines.join(' ') });
  }

  return turns;
}

/**
 * Use Claude to extract key signals from a transcript.
 * Returns structured extraction: pain points, timeline, stakeholders, etc.
 */
export async function extractSignals(rawTranscript, allTranscripts) {
  if (MOCK_MODE) {
    return {
      pain_statements: [
        'Patchwork of spreadsheets and legacy corporate card program causing visibility gaps',
        'Three instances of out-of-policy spend caught only after the fact last quarter',
        'Reconciliation process consuming 15 hours/week of finance team time',
      ],
      timeline_signals: [
        'Board commitment to address spend management in Q1',
        'Headcount scaling from 200 to 350 employees by end of year — problem triples if unsolved',
      ],
      stakeholders: [
        { name: 'Marcus Chen', title: 'CFO', company: 'Acme Corp', role: 'economic_buyer' },
        { name: 'Sarah Park', title: 'VP Finance', company: 'Acme Corp', role: 'champion' },
        { name: 'David Kim', title: 'Head of IT', company: 'Acme Corp', role: 'technical_buyer' },
        { name: 'Jane Smith', title: 'Account Executive', company: 'Ramp', role: 'unknown' },
      ],
      competitor_mentions: ['Brex', 'Divvy'],
      commitment_signals: [
        'Ramp product demo was described as "most impressive"',
        'Sarah agreed to Thursday technical call',
        'Marcus confirmed David Kim will join technical call',
        'Pilot structure of 20 employees for two weeks agreed upon as next step',
      ],
      open_questions: [
        'NetSuite ERP integration compatibility not yet confirmed',
        'SSO requirements need technical validation',
        'Final pricing fit within $80k annual software budget not confirmed',
      ],
      action_items: [
        'Jane to send technical call invite for Thursday with Solutions Engineering',
        'David Kim to join Thursday call to evaluate SSO and NetSuite integration',
        'Jane to include pilot structure proposal in calendar invite',
      ],
      key_quotes: [
        '"Your product demo last week was the most impressive. The real-time visibility and policy enforcement is exactly what we need." — Marcus Chen',
        '"We genuinely don\'t know what\'s being spent until the credit card statement arrives. It\'s embarrassing to present to the board." — Sarah Park',
        '"If we don\'t fix this now, the problem triples." — Marcus Chen',
        '"We usually do a 2-3 week evaluation, get legal to review the contract, then Marcus approves." — Sarah Park',
      ],
    };
  }

  const context = allTranscripts.length > 1
    ? `This is call ${allTranscripts.length} in the deal. Full transcript history is provided.`
    : 'This is the first call in the deal.';

  const transcriptHistory = allTranscripts
    .map((t, i) => `--- CALL ${i + 1} (${t.date}) ---\n${t.content}`)
    .join('\n\n');

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4096,
    thinking: { type: 'adaptive' },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `${context}

Analyze the following call transcript(s) and extract key signals. Return a JSON object with this exact structure:

{
  "pain_statements": ["exact quotes or paraphrases of pain points mentioned"],
  "timeline_signals": ["any mentions of deadlines, urgency, or time constraints"],
  "stakeholders": [
    { "name": "string", "title": "string", "company": "string", "role": "champion|economic_buyer|technical_buyer|blocker|unknown" }
  ],
  "competitor_mentions": ["any competitors mentioned"],
  "commitment_signals": ["positive buying signals or commitments made"],
  "open_questions": ["questions raised but not resolved"],
  "action_items": ["specific next steps agreed upon"],
  "key_quotes": ["notable verbatim quotes showing intent, hesitation, or commitment"]
}

Only include what is explicitly stated. Return valid JSON only, no markdown.

TRANSCRIPT HISTORY:
${transcriptHistory}`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('No text response from Claude during signal extraction');

  try {
    return JSON.parse(textBlock.text);
  } catch {
    // Attempt to extract JSON from the response
    const match = textBlock.text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Failed to parse signal extraction JSON from Claude response');
  }
}

/**
 * Format all transcripts for use in Claude prompts.
 */
export function formatTranscriptsForPrompt(transcripts) {
  return transcripts
    .map((t, i) => `--- CALL ${i + 1} (${t.date}, file: ${path.basename(t.file)}) ---\n${t.content}`)
    .join('\n\n');
}

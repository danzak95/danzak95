import Anthropic from '@anthropic-ai/sdk';
import { formatTranscriptsForPrompt } from './ingest.js';
import { GATE_DEFINITIONS, gatesSummary } from './gates.js';
import { stageName } from './detect.js';

const client = new Anthropic();

const SYSTEM_PROMPT = `You are a sales intelligence assistant for a Ramp sales rep. You analyze call transcripts to determine deal stage, evaluate decision tree gates, identify blockers, and generate pre-call briefs. Be direct, specific, and actionable. Reference actual transcript evidence when making assessments. Never hallucinate details not present in the transcripts.`;

/**
 * Generate a full pre-call brief using streaming.
 * Streams output to stdout and returns the final text.
 */
export async function generateBrief(deal, gateDetails, blockers, signals, regressionFlags) {
  const transcriptText = formatTranscriptsForPrompt(deal.transcripts);
  const { confirmed, total } = gatesSummary(deal.gates, deal.current_stage);
  const stageLabel = stageName(deal.current_stage);

  // Build gate status summary for prompt
  const gateStatusLines = [];
  for (let s = 1; s <= deal.current_stage; s++) {
    const stageDef = GATE_DEFINITIONS[s];
    gateStatusLines.push(`\nSTAGE ${s}: ${stageDef.label}`);
    for (const [key, def] of Object.entries(stageDef.gates)) {
      const detail = gateDetails?.[s]?.[key];
      const status = deal.gates[s]?.[key] || 'unaddressed';
      const evidence = detail?.evidence ? ` | Evidence: ${detail.evidence}` : '';
      const blocker = detail?.blocker ? ` | Blocker: ${detail.blocker}` : '';
      gateStatusLines.push(`  [${status.toUpperCase()}] ${def.question}${evidence}${blocker}`);
    }
  }

  const blockerLines = blockers.map(
    (b) =>
      `- Stage ${b.stage} (${b.stage_label}) — ${b.question}\n  Blocker: ${b.blocker || 'unspecified'}\n  Recommended action: ${b.recommended_action}`
  );

  const regressionSection = regressionFlags.length
    ? `REGRESSION FLAGS:\n${regressionFlags.map((f) => `- ${f}`).join('\n')}`
    : '';

  const prompt = `Generate a pre-call brief for the following deal. Be direct, specific, and actionable. Reference actual transcript evidence. Use the exact section headers listed below.

DEAL INFO:
- Company: ${deal.company}
- Rep: ${deal.rep}
- Current Stage: ${deal.current_stage} — ${stageLabel} (${confirmed}/${total} gates confirmed)
- Total Calls on Record: ${deal.transcripts.length}

GATE EVALUATION:
${gateStatusLines.join('\n')}

ACTIVE BLOCKERS:
${blockerLines.length ? blockerLines.join('\n\n') : 'None identified.'}

${regressionSection}

EXTRACTED SIGNALS:
Pain Statements: ${signals?.pain_statements?.join('; ') || 'None extracted'}
Timeline Signals: ${signals?.timeline_signals?.join('; ') || 'None extracted'}
Stakeholders: ${signals?.stakeholders?.map((s) => `${s.name} (${s.title}, ${s.role})`).join(', ') || 'None identified'}
Competitor Mentions: ${signals?.competitor_mentions?.join(', ') || 'None'}
Commitment Signals: ${signals?.commitment_signals?.join('; ') || 'None'}
Open Questions: ${signals?.open_questions?.join('; ') || 'None'}
Action Items: ${signals?.action_items?.join('; ') || 'None'}

TRANSCRIPT HISTORY:
${transcriptText}

---

Generate the pre-call brief with EXACTLY these sections:

## CURRENT STAGE
[Stage number and name, gates confirmed vs total, brief status assessment]

## DESIRED OUTCOME
[The single most important thing to accomplish on the next call, specific and measurable]

## OPEN GATES
[List each unconfirmed or blocked gate with transcript evidence for why it's open]

## ROADBLOCKS
[Each identified blocker with the recommended action to clear it]

## STAKEHOLDER MAP
[Who has been on calls, their roles, who is missing and needs to be engaged]

## KEY MOMENTS
[3-5 notable verbatim quotes from transcripts showing intent, hesitation, or commitment]

## SUGGESTED TALK TRACK
[Opening line, 3-4 key questions to ask, objection handling for likely pushback]

## NEXT STEPS
[Specific asks to make on the next call, each with an owner and timeline]`;

  process.stdout.write('\n');

  // Stream the brief generation
  let fullText = '';
  const stream = client.messages.stream({
    model: 'claude-opus-4-6',
    max_tokens: 8192,
    thinking: { type: 'adaptive' },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });

  stream.on('text', (text) => {
    process.stdout.write(text);
    fullText += text;
  });

  await stream.finalMessage();
  process.stdout.write('\n');

  return fullText;
}

/**
 * Generate a post-call diff — what changed since the previous call.
 */
export async function generatePostCallDiff(deal, previousGates, currentGates, regressionFlags) {
  const changes = [];

  for (let s = 1; s <= 6; s++) {
    if (!deal.gates[s]) continue;
    for (const key of Object.keys(deal.gates[s])) {
      const prev = previousGates?.[s]?.[key] || 'unaddressed';
      const curr = currentGates[s]?.[key] || 'unaddressed';
      if (prev !== curr) {
        changes.push({ stage: s, gate: key, from: prev, to: curr });
      }
    }
  }

  if (changes.length === 0 && regressionFlags.length === 0) {
    return 'No gate status changes detected since the previous call.';
  }

  const lines = ['POST-CALL CHANGES:'];
  for (const c of changes) {
    const arrow = c.to === 'confirmed' ? '✓' : c.to === 'blocked' ? '✗' : '○';
    lines.push(`  ${arrow} Stage ${c.stage} / ${c.gate}: ${c.from} → ${c.to}`);
  }

  if (regressionFlags.length) {
    lines.push('\nREGRESSIONS DETECTED:');
    for (const flag of regressionFlags) {
      lines.push(`  ⚠ ${flag}`);
    }
  }

  return lines.join('\n');
}

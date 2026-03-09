import Anthropic from '@anthropic-ai/sdk';
import { formatTranscriptsForPrompt } from './ingest.js';
import { GATE_DEFINITIONS, gatesSummary } from './gates.js';
import { stageName } from './detect.js';

const MOCK_MODE = process.env.MOCK_MODE === 'true';
const client = MOCK_MODE ? null : new Anthropic();

const SYSTEM_PROMPT = `You are a sales intelligence assistant for a Ramp sales rep. You analyze call transcripts to determine deal stage, evaluate decision tree gates, identify blockers, and generate pre-call briefs. Be direct, specific, and actionable. Reference actual transcript evidence when making assessments. Never hallucinate details not present in the transcripts.`;

/**
 * Generate a full pre-call brief using streaming.
 * Streams output to stdout and returns the final text.
 */
export async function generateBrief(deal, gateDetails, blockers, signals, regressionFlags) {
  if (MOCK_MODE) {
    const brief = `
## CURRENT STAGE
**Stage 2 — Qualification** | 4/5 gates confirmed

Discovery is complete. Qualification is substantially progressed: economic buyer (Marcus Chen, CFO) identified and accessible, champion (Sarah Park) active, procurement process documented, and $80k budget acknowledged. The one open gate is stakeholder mapping — David Kim (Head of IT) is a named technical approver who has not yet been introduced.

---

## DESIRED OUTCOME
Get David Kim on the Thursday technical call and confirm his SSO + NetSuite integration requirements so the deal can advance to Stage 3 (Technical Validation) immediately following.

---

## OPEN GATES

**[Stage 2] Are all stakeholders mapped?**
- Status: BLOCKED
- Evidence: Marcus referenced David Kim as required for SSO and ERP integration decisions, but David has not been on any call and has not been formally introduced.
- Action needed: Confirm David Kim is on Thursday's technical call; send him pre-read materials beforehand.

**[Stage 2] Is there confirmed budget?**
- Status: CONFIRMED with a caveat
- Evidence: "$80,000 earmarked for the year" — but Marcus noted the final number might need a separate approval depending on price. Pricing conversation hasn't happened yet.
- Action needed: Surface ballpark pricing before or during the next call to pressure-test budget fit.

**[Stage 3] Is Ramp the vendor of choice?**
- Status: UNADDRESSED
- Evidence: Marcus said Ramp's demo was "most impressive" but Brex and Divvy are still in consideration. Technical validation hasn't occurred.
- Action needed: After the NetSuite integration is confirmed, ask directly: "What would need to be true for Ramp to win this?"

---

## ROADBLOCKS

1. **David Kim not yet engaged**
   - Blocker: He controls SSO and ERP integration sign-off and has not been on a call.
   - Recommended action: Confirm he's on Thursday's technical call. Send him a brief pre-read on Ramp's NetSuite connector and SSO (SAML/SCIM) support before the call.

2. **Technical validation pending**
   - Blocker: Until NetSuite integration and SSO are confirmed working, Marcus and Sarah cannot move forward.
   - Recommended action: Have Solutions Engineering prepare a live NetSuite demo for Thursday. Come with a written integration checklist to leave behind.

3. **Competitive pressure from Brex and Divvy**
   - Blocker: Deal is not yet sole-sourced.
   - Recommended action: After technical validation, directly ask "What would need to be true for Ramp to win?" and position Ramp's real-time policy enforcement vs. competitors' reactive spend controls.

---

## STAKEHOLDER MAP

| Name | Title | Role | Status |
|------|-------|------|--------|
| Marcus Chen | CFO | Economic Buyer | ✓ Engaged — decision authority confirmed |
| Sarah Park | VP Finance | Champion | ✓ Engaged — running evaluation |
| David Kim | Head of IT | Technical Buyer | ✗ Named but not yet on a call |

**Missing:** Executive sponsor above Marcus not identified. Legal/procurement contact unknown (will matter in Stage 5).

---

## KEY MOMENTS

> *"Your product demo last week was the most impressive. The real-time visibility and policy enforcement is exactly what we need. We just need to make sure the NetSuite integration works."*
> — Marcus Chen (CFO) — strongest buying signal; conditions the deal on technical validation.

> *"We genuinely don't know what's being spent until the credit card statement arrives. It's embarrassing to present to the board."*
> — Sarah Park (VP Finance) — emotional pain articulation; use this language back to them.

> *"If we don't fix this now, the problem triples."*
> — Marcus Chen — self-generated urgency tied to headcount growth; anchor future urgency arguments here.

> *"We usually do a 2-3 week evaluation, get legal to review the contract, then Marcus approves. Nothing too complicated."*
> — Sarah Park — procurement process is clean and fast; no procurement red flags.

---

## SUGGESTED TALK TRACK

**Opening:**
"Marcus, Sarah — thanks for setting up Thursday. Before we get into the technical details with David, I wanted to do a quick check-in. You mentioned the demo was the most impressive you'd seen. What's your current thinking on the evaluation — are we tracking toward a decision by end of Q1?"

**Key questions to ask:**
1. "David, to make sure we cover everything in today's call — can you walk me through your NetSuite environment and how you currently handle SSO for SaaS tools?" *(unblocks technical validation)*
2. "Marcus, you mentioned the $80k budget earmark — have you had a chance to think about what the right number looks like for a 200-seat deployment? I want to make sure we're aligned before we put a formal proposal together." *(pressure-tests budget fit)*
3. "After today's technical call, what would the path to a decision look like on your end? Are there any other stakeholders we haven't met yet?" *(surfaces hidden blockers)*
4. "You mentioned Brex and Divvy are also in the mix — what are you seeing as the key differences so far?" *(competitive intel + chance to differentiate)*

**Objection handling:**
- *"We need to see if the integration actually works before we commit"* → "Completely fair — that's exactly why we're here today. Our SE team has done 40+ NetSuite implementations. Let's get your specific config mapped out and I can have a written integration confirmation to you by Friday."
- *"The price needs to fit the budget"* → "I hear you. What I'd suggest is — let's nail the technical fit today, and then I'll put together a proposal built around your 200-seat rollout with a path to the 350-seat expansion. That way you can compare apples to apples."

---

## NEXT STEPS

1. **Jane Smith** — Send David Kim a pre-read (Ramp NetSuite connector overview + SSO guide) before Thursday's call. *Today.*
2. **Solutions Engineering** — Prepare live NetSuite demo for Thursday's call and bring written integration checklist. *Before Thursday.*
3. **Jane Smith** — At the end of Thursday's call, propose a 20-employee pilot structure and get verbal commitment from Marcus. *Thursday.*
4. **Jane Smith** — Follow up with ballpark pricing by end of week so Marcus can pressure-test against the $80k budget. *Friday.*
5. **Marcus Chen / Sarah Park** — Confirm David Kim's attendance on Thursday's call. *Before Thursday.*
`;
    process.stdout.write(brief);
    return brief;
  }

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

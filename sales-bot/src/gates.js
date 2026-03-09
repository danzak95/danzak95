import Anthropic from '@anthropic-ai/sdk';
import { formatTranscriptsForPrompt } from './ingest.js';

const client = new Anthropic();

const SYSTEM_PROMPT = `You are a sales intelligence assistant for a Ramp sales rep. You analyze call transcripts to determine deal stage, evaluate decision tree gates, identify blockers, and generate pre-call briefs. Be direct, specific, and actionable. Reference actual transcript evidence when making assessments. Never hallucinate details not present in the transcripts.`;

export const GATE_DEFINITIONS = {
  1: {
    label: 'Discovery',
    gates: {
      pain_articulated: {
        question: 'Is the pain clearly articulated?',
        confirmed_action: 'Document it',
        blocked_action: 'Ask "Walk me through what\'s breaking today"',
      },
      pain_significant: {
        question: 'Is the pain significant enough to act?',
        confirmed_action: 'Confirm urgency',
        blocked_action: 'Quantify cost of inaction',
      },
      decision_timeline: {
        question: 'Does the prospect have a decision timeline?',
        confirmed_action: 'Capture date',
        blocked_action: 'Introduce urgency around a deadline',
      },
      internal_agreement: {
        question: 'Is there internal agreement on the pain?',
        confirmed_action: 'Note all stakeholders',
        blocked_action: 'Request intro to others who feel the pain',
      },
    },
  },
  2: {
    label: 'Qualification',
    gates: {
      economic_buyer_identified: {
        question: 'Is the economic buyer identified?',
        confirmed_action: 'Get direct access',
        blocked_action: 'Ask "Who ultimately approves this?"',
      },
      stakeholders_mapped: {
        question: 'Are all stakeholders mapped?',
        confirmed_action: 'Document org chart',
        blocked_action: 'Request intro or org chart from champion',
      },
      procurement_understood: {
        question: 'Is the procurement process understood?',
        confirmed_action: 'Document requirements',
        blocked_action: 'Ask "How does your company buy software?"',
      },
      champion_established: {
        question: 'Is a champion established?',
        confirmed_action: 'Equip with internal selling materials',
        blocked_action: 'Develop the highest-benefit stakeholder',
      },
      budget_confirmed: {
        question: 'Is there confirmed budget?',
        confirmed_action: 'Tie to ROI',
        blocked_action: 'Ask "Is there existing budget or does this need new approval?"',
      },
    },
  },
  3: {
    label: 'Technical Validation',
    gates: {
      technical_evaluation_done: {
        question: 'Has a technical evaluation been completed?',
        confirmed_action: 'Document findings',
        blocked_action: 'Schedule deep-dive or POC',
      },
      technical_requirements_addressed: {
        question: 'Are all technical requirements addressed?',
        confirmed_action: 'Create written checklist',
        blocked_action: 'Escalate to Solutions Engineering',
      },
      vendor_of_choice: {
        question: 'Is Ramp the vendor of choice?',
        confirmed_action: 'Get explicit confirmation',
        blocked_action: 'Ask "What would need to be true for Ramp to win?"',
      },
      security_compliance_passed: {
        question: 'Have security/compliance reviews passed?',
        confirmed_action: 'Collect sign-off',
        blocked_action: 'Proactively send SOC 2, DPA, security docs',
      },
    },
  },
  4: {
    label: 'Mutual Action Plan',
    gates: {
      map_created: {
        question: 'Is a MAP document created and shared?',
        confirmed_action: 'Confirm all tasks and dates',
        blocked_action: 'Draft and send for review',
      },
      map_accepted: {
        question: 'Has the prospect accepted the MAP?',
        confirmed_action: 'Treat as operating document',
        blocked_action: 'Ask "Is there anything missing?"',
      },
      milestones_dated: {
        question: 'Are all milestones realistic and dated?',
        confirmed_action: 'Lock into both calendars',
        blocked_action: 'Renegotiate with specific alternatives',
      },
      map_aligned_to_timeline: {
        question: 'Is the MAP aligned to their decision timeline?',
        confirmed_action: 'Confirm back-cast',
        blocked_action: 'Recalibrate if timeline shifted',
      },
    },
  },
  5: {
    label: 'Commercial Agreement',
    gates: {
      application_submitted: {
        question: 'Has the application been submitted?',
        confirmed_action: 'Confirm receipt',
        blocked_action: 'Identify what\'s blocking submission',
      },
      commercial_terms_agreed: {
        question: 'Are commercial terms agreed upon?',
        confirmed_action: 'Document in writing',
        blocked_action: 'Escalate to manager or deal desk',
      },
      pricing_approved_internal: {
        question: 'Is pricing approved internally at Ramp?',
        confirmed_action: 'Proceed to contract',
        blocked_action: 'Align internally, set timeline expectation',
      },
      prospect_legal_reviewed: {
        question: "Has the prospect's legal/finance reviewed?",
        confirmed_action: 'Confirm no blockers',
        blocked_action: 'Send redlines proactively',
      },
    },
  },
  6: {
    label: 'Execution',
    gates: {
      go_live_date_locked: {
        question: 'Is a target go-live date locked?',
        confirmed_action: 'Build reverse timeline',
        blocked_action: 'Tie to a business event for urgency',
      },
      all_stakeholders_engaged: {
        question: 'Are all stakeholders on both sides engaged?',
        confirmed_action: 'Confirm exec sponsorship',
        blocked_action: 'Map and engage missing stakeholders',
      },
      order_form_generated: {
        question: 'Is the order form generated?',
        confirmed_action: 'Send for signature',
        blocked_action: 'Remove blockers then generate',
      },
      order_form_executed: {
        question: 'Is the order form fully executed?',
        confirmed_action: 'Trigger CS handoff',
        blocked_action: 'Identify who needs to sign and escalate',
      },
      implementation_readiness: {
        question: 'Is implementation readiness confirmed?',
        confirmed_action: 'Schedule kickoff',
        blocked_action: 'Surface data/integration prep needed',
      },
    },
  },
};

/**
 * Use Claude to evaluate all gate questions for stages 1 through currentStage.
 * Returns updated gates object + a list of blockers with recommended actions.
 */
export async function evaluateGates(transcripts, currentStage) {
  const transcriptText = formatTranscriptsForPrompt(transcripts);

  // Build the gate questions for stages 1..currentStage
  const gateQuestions = {};
  for (let s = 1; s <= currentStage; s++) {
    const stageDef = GATE_DEFINITIONS[s];
    gateQuestions[s] = {};
    for (const [key, def] of Object.entries(stageDef.gates)) {
      gateQuestions[s][key] = def.question;
    }
  }

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4096,
    thinking: { type: 'adaptive' },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Evaluate the following sales gate questions against the provided transcript history.

For each gate question, determine:
- "confirmed" — clearly evidenced in the transcript(s)
- "unaddressed" — not discussed or unclear
- "blocked" — discussed but there is a clear obstacle

For blocked gates, identify the specific blocker from the transcript.

Gate questions to evaluate (organized by stage):
${JSON.stringify(gateQuestions, null, 2)}

Return a JSON object with this exact structure:
{
  "gates": {
    "<stage_number>": {
      "<gate_key>": {
        "status": "confirmed" | "unaddressed" | "blocked",
        "evidence": "specific quote or observation from transcript (or null)",
        "blocker": "description of what is blocking this (or null if not blocked)"
      }
    }
  },
  "regression_flags": ["list any gates that appear to have regressed from confirmed to uncertain based on new transcript info"]
}

Return valid JSON only, no markdown.

TRANSCRIPT HISTORY:
${transcriptText}`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('No text response from Claude during gate evaluation');

  let parsed;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    const match = textBlock.text.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]);
    else throw new Error('Failed to parse gate evaluation JSON from Claude response');
  }

  // Merge Claude's evaluation with the full gate structure
  const mergedGates = {};
  for (let s = 1; s <= 6; s++) {
    const stageDef = GATE_DEFINITIONS[s];
    mergedGates[s] = {};
    for (const key of Object.keys(stageDef.gates)) {
      if (parsed.gates?.[s]?.[key]) {
        mergedGates[s][key] = parsed.gates[s][key].status || 'unaddressed';
      } else {
        mergedGates[s][key] = 'unaddressed';
      }
    }
  }

  // Build blockers list with recommended actions
  const blockers = [];
  for (let s = 1; s <= currentStage; s++) {
    const stageDef = GATE_DEFINITIONS[s];
    for (const [key, def] of Object.entries(stageDef.gates)) {
      const evaluation = parsed.gates?.[s]?.[key];
      if (evaluation?.status === 'blocked') {
        blockers.push({
          stage: s,
          stage_label: stageDef.label,
          gate: key,
          question: def.question,
          blocker: evaluation.blocker,
          recommended_action: def.blocked_action,
          evidence: evaluation.evidence,
        });
      }
    }
  }

  return {
    gates: mergedGates,
    gateDetails: parsed.gates || {},
    blockers,
    regression_flags: parsed.regression_flags || [],
  };
}

/**
 * Summarize gate completion for a given stage.
 */
export function gatesSummary(gates, stage) {
  const stageDef = GATE_DEFINITIONS[stage];
  if (!stageDef) return { confirmed: 0, total: 0 };

  const keys = Object.keys(stageDef.gates);
  const confirmed = keys.filter((k) => gates[stage]?.[k] === 'confirmed').length;
  return { confirmed, total: keys.length };
}

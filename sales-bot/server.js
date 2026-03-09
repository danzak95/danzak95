import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { createDeal, getDeal, saveDeal, listDeals, readTranscriptFile } from './src/store.js';
import { extractSignals, parseTranscriptTurns } from './src/ingest.js';
import { detectStage, stageName } from './src/detect.js';
import { evaluateGates, gatesSummary, GATE_DEFINITIONS } from './src/gates.js';
import { generatePostCallDiff } from './src/brief.js';
import Anthropic from '@anthropic-ai/sdk';
import { formatTranscriptsForPrompt } from './src/ingest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOCK_MODE = process.env.MOCK_MODE === 'true';

const app = express();
const PORT = process.env.PORT || 3000;

// Multer — store uploads in /uploads, keep original name
const upload = multer({
  dest: path.join(__dirname, 'uploads'),
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/plain' || file.originalname.endsWith('.txt')) cb(null, true);
    else cb(new Error('Only .txt files are accepted'));
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Deals ──────────────────────────────────────────────────────────────────

app.get('/api/deals', (req, res) => {
  res.json(listDeals());
});

app.post('/api/deals', (req, res) => {
  const { company, rep } = req.body;
  if (!company || !rep) return res.status(400).json({ error: 'company and rep are required' });
  const deal = createDeal({ company, rep });
  res.status(201).json(deal);
});

app.get('/api/deals/:id', (req, res) => {
  try {
    const deal = getDeal(req.params.id);
    const gateSummaries = {};
    for (let s = 1; s <= 6; s++) {
      gateSummaries[s] = gatesSummary(deal.gates, s);
    }
    res.json({ ...deal, gate_summaries: gateSummaries });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.put('/api/deals/:id/stage', (req, res) => {
  try {
    const deal = getDeal(req.params.id);
    const stage = parseInt(req.body.stage);
    if (!stage || stage < 1 || stage > 6) return res.status(400).json({ error: 'stage must be 1-6' });
    deal.current_stage = stage;
    saveDeal(deal);
    res.json({ deal_id: deal.deal_id, current_stage: deal.current_stage });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// ── Transcripts ────────────────────────────────────────────────────────────

app.post('/api/deals/:id/transcripts', upload.single('transcript'), async (req, res) => {
  try {
    const deal = getDeal(req.params.id);

    let rawTranscript, filePath, originalName;

    if (req.file) {
      // Uploaded file
      filePath = req.file.path;
      originalName = req.file.originalname;
      rawTranscript = fs.readFileSync(filePath, 'utf-8');
    } else if (req.body.text) {
      // Pasted text
      originalName = `pasted-${Date.now()}.txt`;
      filePath = path.join(__dirname, 'uploads', originalName);
      rawTranscript = req.body.text;
      fs.writeFileSync(filePath, rawTranscript);
    } else {
      return res.status(400).json({ error: 'Provide a transcript file or text' });
    }

    const callDate = req.body.date || new Date().toISOString().split('T')[0];
    const participants = parseTranscriptTurns(rawTranscript)
      .map((t) => t.speaker)
      .filter((v, i, a) => a.indexOf(v) === i);

    const transcriptEntry = {
      date: callDate,
      file: originalName,
      content: rawTranscript,
      participants,
      added_at: new Date().toISOString(),
    };

    deal.transcripts.push(transcriptEntry);

    const previousGates = JSON.parse(JSON.stringify(deal.gates));

    const [stageResult, signals] = await Promise.all([
      detectStage(deal.transcripts),
      extractSignals(rawTranscript, deal.transcripts),
    ]);

    if (stageResult.stage > deal.current_stage) {
      deal.current_stage = stageResult.stage;
    }

    const { gates, gateDetails, blockers, regression_flags } = await evaluateGates(
      deal.transcripts,
      deal.current_stage
    );

    deal.gates = gates;

    if (signals.stakeholders) {
      for (const s of signals.stakeholders) {
        const exists = deal.stakeholders.find((x) => x.name.toLowerCase() === s.name.toLowerCase());
        if (!exists) deal.stakeholders.push(s);
        else Object.assign(exists, s);
      }
    }

    saveDeal(deal);

    const diff = await generatePostCallDiff(deal, previousGates, gates, regression_flags);
    const gateSummaries = {};
    for (let s = 1; s <= 6; s++) gateSummaries[s] = gatesSummary(deal.gates, s);

    res.json({
      deal_id: deal.deal_id,
      current_stage: deal.current_stage,
      stage_name: stageName(deal.current_stage),
      stage_result: stageResult,
      signals,
      gates: deal.gates,
      gate_details: gateDetails,
      gate_summaries: gateSummaries,
      blockers,
      diff,
      regression_flags,
      transcript_count: deal.transcripts.length,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── Brief (SSE streaming) ──────────────────────────────────────────────────

app.get('/api/deals/:id/brief', async (req, res) => {
  try {
    const deal = getDeal(req.params.id);

    if (!deal.transcripts.length) {
      return res.status(400).json({ error: 'No transcripts added yet' });
    }

    // Set up Server-Sent Events
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    if (MOCK_MODE) {
      const { gateDetails, blockers, regression_flags } = await evaluateGates(
        deal.transcripts,
        deal.current_stage
      );
      const signals = await extractSignals(deal.transcripts.at(-1).content, deal.transcripts);

      // Import mock brief and stream it word-by-word to simulate streaming
      const { generateBrief } = await import('./src/brief.js');
      let captured = '';
      const origWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = (chunk) => { captured += chunk; return true; };
      await generateBrief(deal, gateDetails, blockers, signals, regression_flags);
      process.stdout.write = origWrite;

      // Stream captured text in small chunks
      const words = captured.split(/(\s+)/);
      for (const word of words) {
        send('token', { text: word });
        await new Promise((r) => setTimeout(r, 8));
      }
      send('done', { message: 'Brief complete' });
      res.end();
      return;
    }

    // Live mode — stream from Claude
    const { gateDetails, blockers, regression_flags } = await evaluateGates(
      deal.transcripts,
      deal.current_stage
    );
    const signals = await extractSignals(deal.transcripts.at(-1).content, deal.transcripts);

    const { confirmed, total } = gatesSummary(deal.gates, deal.current_stage);
    const stageLabel = stageName(deal.current_stage);
    const transcriptText = formatTranscriptsForPrompt(deal.transcripts);

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
      (b) => `- Stage ${b.stage} (${b.stage_label}) — ${b.question}\n  Blocker: ${b.blocker || 'unspecified'}\n  Recommended action: ${b.recommended_action}`
    );

    const client = new Anthropic();
    const SYSTEM_PROMPT = `You are a sales intelligence assistant for a Ramp sales rep. You analyze call transcripts to determine deal stage, evaluate decision tree gates, identify blockers, and generate pre-call briefs. Be direct, specific, and actionable. Reference actual transcript evidence when making assessments. Never hallucinate details not present in the transcripts.`;

    const stream = client.messages.stream({
      model: 'claude-opus-4-6',
      max_tokens: 8192,
      thinking: { type: 'adaptive' },
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Generate a pre-call brief for the following deal.

DEAL INFO:
- Company: ${deal.company} | Rep: ${deal.rep}
- Current Stage: ${deal.current_stage} — ${stageLabel} (${confirmed}/${total} gates confirmed)
- Total Calls: ${deal.transcripts.length}

GATE EVALUATION:
${gateStatusLines.join('\n')}

ACTIVE BLOCKERS:
${blockerLines.length ? blockerLines.join('\n\n') : 'None identified.'}

EXTRACTED SIGNALS:
Pain: ${signals?.pain_statements?.join('; ')}
Timeline: ${signals?.timeline_signals?.join('; ')}
Stakeholders: ${signals?.stakeholders?.map((s) => `${s.name} (${s.title}, ${s.role})`).join(', ')}
Competitors: ${signals?.competitor_mentions?.join(', ') || 'None'}
Commitments: ${signals?.commitment_signals?.join('; ')}
Open Questions: ${signals?.open_questions?.join('; ')}
Action Items: ${signals?.action_items?.join('; ')}

TRANSCRIPT HISTORY:
${transcriptText}

Generate the brief with EXACTLY these section headers:
## CURRENT STAGE
## DESIRED OUTCOME
## OPEN GATES
## ROADBLOCKS
## STAKEHOLDER MAP
## KEY MOMENTS
## SUGGESTED TALK TRACK
## NEXT STEPS`,
      }],
    });

    stream.on('text', (text) => send('token', { text }));
    await stream.finalMessage();
    send('done', { message: 'Brief complete' });
    res.end();

  } catch (e) {
    console.error(e);
    res.write(`event: error\ndata: ${JSON.stringify({ error: e.message })}\n\n`);
    res.end();
  }
});

// ── Gate definitions (for UI rendering) ───────────────────────────────────

app.get('/api/gate-definitions', (req, res) => {
  res.json(GATE_DEFINITIONS);
});

// ── Start ──────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n  Sales Bot running at http://localhost:${PORT}`);
  console.log(`  Mock mode: ${MOCK_MODE ? 'ON' : 'OFF'}\n`);
});

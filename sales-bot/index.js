#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import path from 'path';
import { fileURLToPath } from 'url';

import { createDeal, getDeal, saveDeal, listDeals, readTranscriptFile } from './src/store.js';
import { extractSignals, parseTranscriptTurns } from './src/ingest.js';
import { detectStage, stageName } from './src/detect.js';
import { evaluateGates, gatesSummary, GATE_DEFINITIONS } from './src/gates.js';
import { generateBrief, generatePostCallDiff } from './src/brief.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const program = new Command();

program
  .name('sales-bot')
  .description('AI-powered sales call preparation assistant')
  .version('1.0.0');

// ── new ──────────────────────────────────────────────────────────────────────
program
  .command('new')
  .description('Create a new deal')
  .requiredOption('--company <name>', 'Company name')
  .requiredOption('--rep <name>', 'Rep name')
  .action((opts) => {
    const deal = createDeal({ company: opts.company, rep: opts.rep });
    console.log(`\n✓ Deal created`);
    console.log(`  ID:      ${deal.deal_id}`);
    console.log(`  Company: ${deal.company}`);
    console.log(`  Rep:     ${deal.rep}`);
    console.log(`  Stage:   1 — Discovery\n`);
  });

// ── list ─────────────────────────────────────────────────────────────────────
program
  .command('list')
  .description('List all deals')
  .action(() => {
    const deals = listDeals();
    if (!deals.length) {
      console.log('\nNo deals found. Run: sales-bot new --company "..." --rep "..."\n');
      return;
    }
    console.log('\nDEALS:');
    for (const d of deals) {
      console.log(
        `  ${d.deal_id.slice(0, 8)}... | ${d.company.padEnd(25)} | Stage ${d.current_stage} — ${stageName(d.current_stage).padEnd(22)} | ${d.rep}`
      );
    }
    console.log('');
  });

// ── add-transcript ────────────────────────────────────────────────────────────
program
  .command('add-transcript')
  .description('Add a transcript to a deal and re-evaluate gates')
  .requiredOption('--deal <id>', 'Deal ID (or prefix)')
  .requiredOption('--file <path>', 'Path to transcript .txt file')
  .option('--date <date>', 'Call date (ISO format, defaults to today)')
  .option('--participants <names>', 'Comma-separated participant names')
  .action(async (opts) => {
    try {
      const deal = resolveDeal(opts.deal);
      const rawTranscript = readTranscriptFile(opts.file);
      const callDate = opts.date || new Date().toISOString().split('T')[0];
      const participants = opts.participants
        ? opts.participants.split(',').map((p) => p.trim())
        : parseTranscriptTurns(rawTranscript).map((t) => t.speaker).filter((v, i, a) => a.indexOf(v) === i);

      const transcriptEntry = {
        date: callDate,
        file: opts.file,
        content: rawTranscript,
        participants,
        added_at: new Date().toISOString(),
      };

      deal.transcripts.push(transcriptEntry);

      console.log(`\nAnalyzing transcript...`);

      // Save snapshot of previous gates for diff
      const previousGates = JSON.parse(JSON.stringify(deal.gates));

      // Run all analyses in parallel
      const [stageResult, signals] = await Promise.all([
        detectStage(deal.transcripts),
        extractSignals(rawTranscript, deal.transcripts),
      ]);

      console.log(`Stage detected: ${stageResult.stage} — ${stageName(stageResult.stage)} (confidence: ${(stageResult.confidence * 100).toFixed(0)}%)`);

      // Only advance stage automatically; never regress automatically
      if (stageResult.stage > deal.current_stage) {
        console.log(`  ↑ Advancing from Stage ${deal.current_stage} to Stage ${stageResult.stage}`);
        deal.current_stage = stageResult.stage;
      }

      // Evaluate gates
      const { gates, gateDetails, blockers, regression_flags } = await evaluateGates(
        deal.transcripts,
        deal.current_stage
      );

      deal.gates = gates;

      // Merge stakeholders (deduplicate by name)
      if (signals.stakeholders) {
        for (const s of signals.stakeholders) {
          const exists = deal.stakeholders.find((x) => x.name.toLowerCase() === s.name.toLowerCase());
          if (!exists) deal.stakeholders.push(s);
          else Object.assign(exists, s);
        }
      }

      saveDeal(deal);

      // Show diff
      const diff = await generatePostCallDiff(deal, previousGates, gates, regression_flags);
      console.log('\n' + diff);

      // Show current gate summary
      printGateSummary(deal);

      console.log(`\n✓ Transcript added. Run 'sales-bot brief --deal ${deal.deal_id.slice(0, 8)}' to generate a pre-call brief.\n`);
    } catch (err) {
      console.error(`\nError: ${err.message}\n`);
      process.exit(1);
    }
  });

// ── status ────────────────────────────────────────────────────────────────────
program
  .command('status')
  .description('Show current gate status for a deal')
  .requiredOption('--deal <id>', 'Deal ID (or prefix)')
  .action((opts) => {
    try {
      const deal = resolveDeal(opts.deal);
      console.log(`\nDEAL: ${deal.company} (${deal.rep})`);
      console.log(`ID:   ${deal.deal_id}`);
      console.log(`Stage: ${deal.current_stage} — ${stageName(deal.current_stage)}`);
      console.log(`Calls: ${deal.transcripts.length}`);
      printGateSummary(deal);
    } catch (err) {
      console.error(`\nError: ${err.message}\n`);
      process.exit(1);
    }
  });

// ── set-stage ─────────────────────────────────────────────────────────────────
program
  .command('set-stage')
  .description('Manually override the deal stage')
  .requiredOption('--deal <id>', 'Deal ID (or prefix)')
  .requiredOption('--stage <number>', 'Stage number (1-6)', parseInt)
  .action((opts) => {
    try {
      if (opts.stage < 1 || opts.stage > 6) {
        console.error('\nError: Stage must be between 1 and 6\n');
        process.exit(1);
      }
      const deal = resolveDeal(opts.deal);
      const prev = deal.current_stage;
      deal.current_stage = opts.stage;
      saveDeal(deal);
      console.log(`\n✓ Stage updated: ${prev} (${stageName(prev)}) → ${opts.stage} (${stageName(opts.stage)})\n`);
    } catch (err) {
      console.error(`\nError: ${err.message}\n`);
      process.exit(1);
    }
  });

// ── brief ─────────────────────────────────────────────────────────────────────
program
  .command('brief')
  .description('Generate a pre-call brief for a deal')
  .requiredOption('--deal <id>', 'Deal ID (or prefix)')
  .action(async (opts) => {
    try {
      const deal = resolveDeal(opts.deal);

      if (!deal.transcripts.length) {
        console.error('\nError: No transcripts added yet. Run add-transcript first.\n');
        process.exit(1);
      }

      console.log(`\nGenerating pre-call brief for ${deal.company}...`);
      console.log('─'.repeat(60));

      // Re-evaluate gates to get full details for the brief
      const { gateDetails, blockers, regression_flags } = await evaluateGates(
        deal.transcripts,
        deal.current_stage
      );

      // Extract signals from all transcripts
      const signals = await extractSignals(
        deal.transcripts[deal.transcripts.length - 1].content,
        deal.transcripts
      );

      await generateBrief(deal, gateDetails, blockers, signals, regression_flags);

      console.log('─'.repeat(60));
      console.log('');
    } catch (err) {
      console.error(`\nError: ${err.message}\n`);
      process.exit(1);
    }
  });

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Resolve a deal by full ID or prefix. Throws if not found or ambiguous.
 */
function resolveDeal(idOrPrefix) {
  try {
    return getDeal(idOrPrefix);
  } catch {
    // Try prefix match
    const all = listDeals();
    const matches = all.filter((d) => d.deal_id.startsWith(idOrPrefix));
    if (matches.length === 0) throw new Error(`No deal found matching: ${idOrPrefix}`);
    if (matches.length > 1) throw new Error(`Ambiguous deal prefix: ${idOrPrefix} matches ${matches.length} deals`);
    return getDeal(matches[0].deal_id);
  }
}

/**
 * Print a formatted gate summary table to stdout.
 */
function printGateSummary(deal) {
  console.log('');
  for (let s = 1; s <= deal.current_stage; s++) {
    const stageDef = GATE_DEFINITIONS[s];
    const { confirmed, total } = gatesSummary(deal.gates, s);
    console.log(`STAGE ${s}: ${stageDef.label} (${confirmed}/${total})`);

    for (const [key, def] of Object.entries(stageDef.gates)) {
      const status = deal.gates[s]?.[key] || 'unaddressed';
      const icon = status === 'confirmed' ? '✓' : status === 'blocked' ? '✗' : '○';
      console.log(`  ${icon} ${def.question}`);
    }
    console.log('');
  }
}

program.parse();

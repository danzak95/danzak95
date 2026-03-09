import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEALS_DIR = path.join(__dirname, '..', 'deals');

function ensureDealsDir() {
  if (!fs.existsSync(DEALS_DIR)) {
    fs.mkdirSync(DEALS_DIR, { recursive: true });
  }
}

function dealPath(dealId) {
  return path.join(DEALS_DIR, `${dealId}.json`);
}

export function createDeal({ company, rep }) {
  ensureDealsDir();
  const deal = {
    deal_id: uuidv4(),
    company,
    rep,
    current_stage: 1,
    transcripts: [],
    gates: {
      1: {
        pain_articulated: 'unaddressed',
        pain_significant: 'unaddressed',
        decision_timeline: 'unaddressed',
        internal_agreement: 'unaddressed',
      },
      2: {
        economic_buyer_identified: 'unaddressed',
        stakeholders_mapped: 'unaddressed',
        procurement_understood: 'unaddressed',
        champion_established: 'unaddressed',
        budget_confirmed: 'unaddressed',
      },
      3: {
        technical_evaluation_done: 'unaddressed',
        technical_requirements_addressed: 'unaddressed',
        vendor_of_choice: 'unaddressed',
        security_compliance_passed: 'unaddressed',
      },
      4: {
        map_created: 'unaddressed',
        map_accepted: 'unaddressed',
        milestones_dated: 'unaddressed',
        map_aligned_to_timeline: 'unaddressed',
      },
      5: {
        application_submitted: 'unaddressed',
        commercial_terms_agreed: 'unaddressed',
        pricing_approved_internal: 'unaddressed',
        prospect_legal_reviewed: 'unaddressed',
      },
      6: {
        go_live_date_locked: 'unaddressed',
        all_stakeholders_engaged: 'unaddressed',
        order_form_generated: 'unaddressed',
        order_form_executed: 'unaddressed',
        implementation_readiness: 'unaddressed',
      },
    },
    stakeholders: [],
    notes: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  fs.writeFileSync(dealPath(deal.deal_id), JSON.stringify(deal, null, 2));
  return deal;
}

export function getDeal(dealId) {
  const fp = dealPath(dealId);
  if (!fs.existsSync(fp)) {
    throw new Error(`Deal not found: ${dealId}`);
  }
  return JSON.parse(fs.readFileSync(fp, 'utf-8'));
}

export function saveDeal(deal) {
  ensureDealsDir();
  deal.updated_at = new Date().toISOString();
  fs.writeFileSync(dealPath(deal.deal_id), JSON.stringify(deal, null, 2));
  return deal;
}

export function listDeals() {
  ensureDealsDir();
  return fs
    .readdirSync(DEALS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const deal = JSON.parse(fs.readFileSync(path.join(DEALS_DIR, f), 'utf-8'));
      return {
        deal_id: deal.deal_id,
        company: deal.company,
        rep: deal.rep,
        current_stage: deal.current_stage,
        updated_at: deal.updated_at,
      };
    })
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
}

export function readTranscriptFile(filePath) {
  const resolved = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Transcript file not found: ${resolved}`);
  }
  return fs.readFileSync(resolved, 'utf-8');
}

/* ── State ───────────────────────────────────────────────────────────────── */
let deals = [];
let currentDeal = null;
let gateDefinitions = {};
let selectedFile = null;
let briefStreaming = false;

/* ── Init ────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([loadGateDefinitions(), loadDeals()]);
  bindEvents();
  // Default today's date in transcript modal
  document.getElementById('transcript-date').value = new Date().toISOString().split('T')[0];
});

/* ── Data ────────────────────────────────────────────────────────────────── */
async function loadGateDefinitions() {
  const res = await fetch('/api/gate-definitions');
  gateDefinitions = await res.json();
}

async function loadDeals() {
  const res = await fetch('/api/deals');
  deals = await res.json();
  renderDealList();
}

async function loadDeal(id) {
  const res = await fetch(`/api/deals/${id}`);
  if (!res.ok) { toast('Failed to load deal', 'error'); return; }
  currentDeal = await res.json();
  renderDealView();
}

/* ── Deal List ───────────────────────────────────────────────────────────── */
function renderDealList() {
  const search = document.getElementById('deal-search').value.toLowerCase();
  const filtered = deals.filter(d =>
    d.company.toLowerCase().includes(search) || d.rep.toLowerCase().includes(search)
  );

  const list = document.getElementById('deal-list');
  list.innerHTML = '';

  if (!filtered.length) {
    list.innerHTML = '<li style="padding:12px 16px;color:var(--text-muted);font-size:12px;">No deals found</li>';
    return;
  }

  for (const deal of filtered) {
    const li = document.createElement('li');
    li.className = 'deal-item' + (currentDeal?.deal_id === deal.deal_id ? ' active' : '');
    li.dataset.id = deal.deal_id;
    li.innerHTML = `
      <div class="deal-item-company">${esc(deal.company)}</div>
      <div class="deal-item-meta">
        <span class="stage-badge">Stage ${deal.current_stage}</span>
        <span class="deal-item-rep">${esc(deal.rep)}</span>
      </div>`;
    li.addEventListener('click', () => loadDeal(deal.deal_id));
    list.appendChild(li);
  }
}

/* ── Deal View ───────────────────────────────────────────────────────────── */
function renderDealView() {
  const deal = currentDeal;
  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('deal-view').classList.remove('hidden');

  document.getElementById('deal-company').textContent = deal.company;
  document.getElementById('deal-rep').textContent = `Rep: ${deal.rep}`;

  renderPipelineBar();
  renderGates();
  renderTranscripts();
  renderStakeholders();

  // Highlight active list item
  document.querySelectorAll('.deal-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === deal.deal_id);
  });
}

/* ── Pipeline Bar ────────────────────────────────────────────────────────── */
const STAGE_NAMES = ['Discovery', 'Qualification', 'Technical Validation', 'Mutual Action Plan', 'Commercial Agreement', 'Execution'];

function renderPipelineBar() {
  const bar = document.getElementById('pipeline-stages');
  bar.innerHTML = '';
  for (let i = 1; i <= 6; i++) {
    const div = document.createElement('div');
    div.className = 'pipeline-stage';
    if (i < currentDeal.current_stage) div.classList.add('done');
    else if (i === currentDeal.current_stage) div.classList.add('current');
    div.innerHTML = `<span class="stage-num">${i}</span>${STAGE_NAMES[i-1]}`;
    div.title = `Set to Stage ${i}`;
    div.addEventListener('click', () => setStage(i));
    bar.appendChild(div);
  }
}

async function setStage(stage) {
  if (stage === currentDeal.current_stage) return;
  const res = await fetch(`/api/deals/${currentDeal.deal_id}/stage`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stage }),
  });
  if (!res.ok) { toast('Failed to update stage', 'error'); return; }
  await loadDeal(currentDeal.deal_id);
  await loadDeals();
  toast(`Stage updated to ${stage} — ${STAGE_NAMES[stage-1]}`, 'success');
}

/* ── Gates ───────────────────────────────────────────────────────────────── */
function renderGates() {
  const container = document.getElementById('gates-content');
  container.innerHTML = '';

  for (let s = 1; s <= currentDeal.current_stage; s++) {
    const stageDef = gateDefinitions[s];
    if (!stageDef) continue;

    const summary = currentDeal.gate_summaries?.[s] || { confirmed: 0, total: 0 };
    const isComplete = summary.confirmed === summary.total;

    const section = document.createElement('div');
    section.className = 'stage-section';
    section.innerHTML = `
      <div class="stage-section-header">
        <span class="stage-section-title">Stage ${s} — ${stageDef.label}</span>
        <span class="stage-progress ${isComplete ? 'complete' : ''}">${summary.confirmed}/${summary.total} confirmed</span>
      </div>
      <div class="gates-list" id="gates-stage-${s}"></div>`;
    container.appendChild(section);

    const gatesList = section.querySelector(`#gates-stage-${s}`);
    for (const [key, def] of Object.entries(stageDef.gates)) {
      const status = currentDeal.gates?.[s]?.[key] || 'unaddressed';
      const icon = status === 'confirmed' ? '✓' : status === 'blocked' ? '✗' : '○';
      const row = document.createElement('div');
      row.className = 'gate-row';
      row.innerHTML = `
        <span class="gate-icon ${status}">${icon}</span>
        <div class="gate-body">
          <div class="gate-question">${esc(def.question)}</div>
          ${status === 'blocked' ? `<div class="gate-action">→ ${esc(def.blocked_action)}</div>` : ''}
          ${status === 'confirmed' ? `<div class="gate-evidence">✔ ${esc(def.confirmed_action)}</div>` : ''}
        </div>
        <span class="gate-status-chip ${status}">${status}</span>`;
      gatesList.appendChild(row);
    }
  }

  // Placeholder for stages above current
  if (currentDeal.current_stage < 6) {
    const note = document.createElement('div');
    note.style.cssText = 'color:var(--text-muted);font-size:13px;padding:8px 0';
    note.textContent = `Stages ${currentDeal.current_stage + 1}–6 will unlock as the deal progresses.`;
    container.appendChild(note);
  }
}

/* ── Transcripts tab ─────────────────────────────────────────────────────── */
function renderTranscripts() {
  const container = document.getElementById('transcripts-list');
  if (!currentDeal.transcripts?.length) {
    container.innerHTML = '<p style="color:var(--text-muted)">No transcripts yet. Add one with the button above.</p>';
    return;
  }
  container.innerHTML = currentDeal.transcripts.map((t, i) => `
    <div class="transcript-card">
      <div class="transcript-meta">
        <span class="transcript-date">Call ${i + 1} — ${t.date}</span>
        <span class="transcript-file">${esc(t.file)}</span>
      </div>
      <div class="transcript-participants">
        Participants: ${t.participants?.join(', ') || 'Unknown'}
      </div>
    </div>`).join('');
}

/* ── Stakeholders tab ────────────────────────────────────────────────────── */
function renderStakeholders() {
  const container = document.getElementById('stakeholders-content');
  if (!currentDeal.stakeholders?.length) {
    container.innerHTML = '<p style="color:var(--text-muted)">No stakeholders identified yet. Add a transcript to populate this.</p>';
    return;
  }
  container.innerHTML = `<div class="stakeholder-grid">${
    currentDeal.stakeholders.map(s => `
      <div class="stakeholder-card">
        <div class="stakeholder-name">${esc(s.name)}</div>
        <div class="stakeholder-title">${esc(s.title)} · ${esc(s.company || '')}</div>
        <span class="stakeholder-role role-${s.role}">${s.role?.replace('_', ' ')}</span>
      </div>`).join('')
  }</div>`;
}

/* ── Brief Generation ────────────────────────────────────────────────────── */
function startBrief() {
  if (briefStreaming) return;
  if (!currentDeal?.transcripts?.length) {
    toast('Add a transcript first', 'error');
    return;
  }

  switchTab('brief');
  document.getElementById('brief-placeholder').classList.add('hidden');
  const output = document.getElementById('brief-output');
  output.classList.remove('hidden');
  output.innerHTML = '<span class="cursor"></span>';

  const btn = document.getElementById('generate-brief-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Generating…';
  briefStreaming = true;

  let rawText = '';

  const evtSource = new EventSource(`/api/deals/${currentDeal.deal_id}/brief`);

  evtSource.addEventListener('token', (e) => {
    const { text } = JSON.parse(e.data);
    rawText += text;
    output.innerHTML = renderMarkdown(rawText) + '<span class="cursor"></span>';
    output.scrollIntoView({ block: 'nearest' });
  });

  evtSource.addEventListener('done', () => {
    evtSource.close();
    briefStreaming = false;
    output.innerHTML = renderMarkdown(rawText);
    btn.disabled = false;
    btn.textContent = 'Regenerate Brief';
  });

  evtSource.addEventListener('error', (e) => {
    evtSource.close();
    briefStreaming = false;
    btn.disabled = false;
    btn.textContent = 'Generate Brief';
    try {
      const { error } = JSON.parse(e.data);
      toast(error || 'Brief generation failed', 'error');
    } catch { toast('Brief generation failed', 'error'); }
  });
}

/* Very lightweight markdown renderer for the brief output */
function renderMarkdown(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // Tables
    .replace(/^\|(.+)\|$/gm, (match) => {
      const cells = match.slice(1, -1).split('|');
      return '<tr>' + cells.map(c => `<td>${c.trim()}</td>`).join('') + '</tr>';
    })
    .replace(/(<tr>.*<\/tr>\n?)+/g, (m) => {
      const rows = m.split('\n').filter(Boolean);
      const [header, ...rest] = rows;
      const th = header.replace(/<td>/g, '<th>').replace(/<\/td>/g, '</th>');
      return `<table>${th}${rest.join('')}</table>`;
    })
    .replace(/\|[-| :]+\|\n?/g, '') // Remove separator rows
    // Headings
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    // Bold / italic
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Blockquotes
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    // HR
    .replace(/^---$/gm, '<hr>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Line breaks — double newlines become paragraph breaks
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '\n');
}

/* ── Add Transcript ──────────────────────────────────────────────────────── */
async function submitTranscript() {
  const date = document.getElementById('transcript-date').value;
  const text = document.getElementById('transcript-text').value.trim();

  if (!selectedFile && !text) {
    toast('Provide a file or paste transcript text', 'error');
    return;
  }

  const btn = document.getElementById('submit-transcript-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Analyzing…';

  const formData = new FormData();
  formData.append('date', date);
  if (selectedFile) formData.append('transcript', selectedFile);
  else formData.append('text', text);

  try {
    const res = await fetch(`/api/deals/${currentDeal.deal_id}/transcripts`, {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');

    closeModal('modal-transcript');
    toast(`Transcript analyzed — Stage ${data.current_stage}: ${data.stage_name}`, 'success');
    await loadDeal(currentDeal.deal_id);
    await loadDeals();
    resetTranscriptForm();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Analyze Transcript';
  }
}

function resetTranscriptForm() {
  selectedFile = null;
  document.getElementById('file-input').value = '';
  document.getElementById('transcript-text').value = '';
  document.getElementById('file-name').classList.add('hidden');
  document.getElementById('file-name').textContent = '';
}

/* ── New Deal ────────────────────────────────────────────────────────────── */
async function createNewDeal() {
  const company = document.getElementById('new-company').value.trim();
  const rep = document.getElementById('new-rep').value.trim();
  if (!company || !rep) { toast('Company and rep are required', 'error'); return; }

  const btn = document.getElementById('create-deal-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Creating…';

  try {
    const res = await fetch('/api/deals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company, rep }),
    });
    const deal = await res.json();
    if (!res.ok) throw new Error(deal.error || 'Failed to create deal');

    closeModal('modal-new-deal');
    document.getElementById('new-company').value = '';
    document.getElementById('new-rep').value = '';

    await loadDeals();
    await loadDeal(deal.deal_id);
    toast(`Deal created for ${company}`, 'success');
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Deal';
  }
}

/* ── Tabs ────────────────────────────────────────────────────────────────── */
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
  document.getElementById(`tab-${name}`)?.classList.remove('hidden');
}

/* ── Modals ──────────────────────────────────────────────────────────────── */
function openModal(id) { document.getElementById(id)?.classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id)?.classList.add('hidden'); }

/* ── Toast ───────────────────────────────────────────────────────────────── */
let toastTimer;
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ── Event Binding ───────────────────────────────────────────────────────── */
function bindEvents() {
  // New deal buttons
  document.getElementById('new-deal-btn').addEventListener('click', () => openModal('modal-new-deal'));
  document.getElementById('empty-new-btn').addEventListener('click', () => openModal('modal-new-deal'));
  document.getElementById('create-deal-btn').addEventListener('click', createNewDeal);

  // Transcript modal
  document.getElementById('add-transcript-btn').addEventListener('click', () => openModal('modal-transcript'));
  document.getElementById('submit-transcript-btn').addEventListener('click', submitTranscript);

  // Generate brief
  document.getElementById('generate-brief-btn').addEventListener('click', startBrief);

  // Modal closes
  document.querySelectorAll('.modal-close, [data-modal]').forEach(el => {
    el.addEventListener('click', () => closeModal(el.dataset.modal));
  });

  // Close modal on backdrop click
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal(modal.id);
    });
  });

  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Deal search
  document.getElementById('deal-search').addEventListener('input', renderDealList);

  // File input
  const fileInput = document.getElementById('file-input');
  fileInput.addEventListener('change', (e) => {
    selectedFile = e.target.files[0] || null;
    if (selectedFile) {
      const fn = document.getElementById('file-name');
      fn.textContent = selectedFile.name;
      fn.classList.remove('hidden');
    }
  });

  // Drop zone
  const dropZone = document.getElementById('drop-zone');
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && (file.type === 'text/plain' || file.name.endsWith('.txt'))) {
      selectedFile = file;
      const fn = document.getElementById('file-name');
      fn.textContent = file.name;
      fn.classList.remove('hidden');
    } else {
      toast('Only .txt files are accepted', 'error');
    }
  });

  // Enter key in new deal form
  ['new-company', 'new-rep'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') createNewDeal();
    });
  });
}

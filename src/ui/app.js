// The UI displays what the engine returns. It computes no totals of its own.

import { load, applyTransfer, subtreeIds } from '../engine/transfer.js';
import { childrenOf } from '../engine/validate.js';
import { DEPARTMENT, SOLO, BROKEN_DUPLICATE, DEMO_TRANSFER, DEMO_CYCLE, DEMO_ROOT_MOVE }
  from '../data/department.js';

const $ = (id) => document.getElementById(id);
const money = (n) => '₹' + n.toLocaleString('en-IN');   // display only, never parsed back

// ---------------------------------------------------------------- state
// `state` is the engine's state. Everything else here is presentation.
let state = null;
let records = DEPARTMENT;    // what Reset restores
let selectedId = null;
let movedIds = new Set();    // ids in the moved subtree (highlight)
let changedIds = new Set();  // ids whose rollups changed (highlight)
let attempts = [];           // every transfer TRIED, accepted or rejected, in order

function loadRecords(recs, { remember = true } = {}) {
  if (remember) records = recs;
  state = load(recs);
  clearTransfer();
  selectedId = state.ok ? state.ix.rootId : null;   // default inspected employee
  render();
}

function clearTransfer() {
  movedIds = new Set();
  changedIds = new Set();
  attempts = [];
}

// ---------------------------------------------------------------- render
function render() {
  const banner = $('banner');
  if (!state.ok) {
    // §4.5 — a failed load shows no tree, no totals, no stale transfer result.
    // Hiding the panel is not enough: wipe the markup so nothing from the
    // previous department survives anywhere in the document.
    for (const id of ['tree', 'cards', 'detail', 'attempts', 'table']) $(id).innerHTML = '';
    $('transfer-msg').hidden = true;
    $('workspace').hidden = true;
    banner.hidden = false;
    banner.className = 'banner error';
    banner.textContent = `Load rejected — ${state.error.code}: ${state.error.message}`;
    return;
  }
  banner.hidden = true;
  $('workspace').hidden = false;

  renderCards();
  renderTree();
  renderDetail();
  renderSelects();
  renderAttempts();
  renderTable();
}

function renderCards() {
  const managers = state.employees.filter(e => childrenOf(state.ix, e.employee_id).length);
  $('cards').innerHTML = managers.map(e => {
    const r = state.rollups.get(e.employee_id);
    const flag = changedIds.has(e.employee_id) ? ' changed' : '';
    const mark = changedIds.has(e.employee_id) ? '<span class="mark">● changed</span>' : '';
    return `<div class="card${flag}">
      <div class="card-id">${e.employee_id}${mark}</div>
      <div class="card-role">${e.role}</div>
      <div class="card-nums"><b>${r.headcount}</b> people &middot; <b>${money(r.payroll)}</b></div>
    </div>`;
  }).join('');
}

function nodeHtml(id) {
  const e = state.ix.byId.get(id);
  const r = state.rollups.get(id);
  const cls = ['node'];
  const marks = [];
  if (id === selectedId) { cls.push('selected'); marks.push('<span class="mark sel">▸ selected</span>'); }
  if (movedIds.has(id))  { cls.push('moved');   marks.push('<span class="mark mv">▲ moved</span>'); }
  if (changedIds.has(id)){ cls.push('changed'); marks.push('<span class="mark ch">● totals changed</span>'); }

  const kids = childrenOf(state.ix, id);
  return `<li>
    <button class="${cls.join(' ')}" data-id="${id}">
      <span class="n-id">${id}</span>
      <span class="n-name">${e.name} — ${e.role}</span>
      <span class="n-num">team ${r.headcount} &middot; ${money(r.payroll)}</span>
      ${marks.join('')}
    </button>
    ${kids.length ? `<ul>${kids.map(nodeHtml).join('')}</ul>` : ''}
  </li>`;
}

function renderTree() {
  $('tree').innerHTML = `<ul class="root">${nodeHtml(state.ix.rootId)}</ul>`;
  for (const b of $('tree').querySelectorAll('button[data-id]'))
    b.onclick = () => { selectedId = b.dataset.id; render(); };   // inspecting changes nothing else
}

function renderDetail() {
  const e = state.ix.byId.get(selectedId);
  const r = state.rollups.get(selectedId);
  const mgr = e.manager_id === null ? '— (department head)' : e.manager_id;
  $('detail').innerHTML = `<dl>
    <div><dt>Employee</dt><dd>${e.employee_id} — ${e.name}</dd></div>
    <div><dt>Role</dt><dd>${e.role}</dd></div>
    <div><dt>Own salary</dt><dd>${money(e.monthly_salary)}</dd></div>
    <div><dt>Reports to</dt><dd>${mgr}</dd></div>
    <div><dt>Direct reports</dt><dd>${childrenOf(state.ix, selectedId).length}</dd></div>
    <div><dt>Team headcount</dt><dd><b>${r.headcount}</b></dd></div>
    <div><dt>Team payroll</dt><dd><b>${money(r.payroll)}</b></dd></div>
  </dl>`;
}

function renderSelects() {
  const opts = state.employees
    .map(e => `<option value="${e.employee_id}">${e.employee_id} — ${e.name}</option>`).join('');
  for (const id of ['sel-employee', 'sel-manager']) {
    const keep = $(id).value;
    $(id).innerHTML = opts;
    if (state.ix.byId.has(keep)) $(id).value = keep;
  }
}

// A numbered log of every transfer tried, accepted or rejected. For each one it
// shows the two managers whose numbers were at stake, so a rejection can be read
// as "these are the totals, and they did not move".
function renderAttempts() {
  if (!attempts.length) {
    $('attempts').innerHTML = '<p class="muted">No transfers attempted yet.</p>';
    return;
  }
  const nm = (id) => !id ? '&mdash;'
    : state.ix.byId.has(id)
      ? `<b>${id}</b> <span class="muted">${state.ix.byId.get(id).name}</span>`
      : `<b>${id}</b> <span class="muted">(no such employee)</span>`;
  const ppl = (n) => `${n} ${n === 1 ? 'person' : 'people'}`;
  const tot = (r) => r ? `${ppl(r.headcount)} &middot; ${money(r.payroll)}` : '&mdash;';

  const mgrPair = (label, oldId, newId, oldBefore, oldAfter, newBefore, newAfter) => `
    <table class="mgr">
      <tr><th>${label}</th><th class="num">Headcount</th><th class="num">Payroll</th></tr>
      <tr><td>Old manager ${oldId ? nm(oldId) : '&mdash;'}</td>
          <td class="num">${oldBefore ? oldBefore.headcount : '&mdash;'}${oldAfter ? ` &rarr; <b>${oldAfter.headcount}</b>` : ''}</td>
          <td class="num">${oldBefore ? money(oldBefore.payroll) : '&mdash;'}${oldAfter ? ` &rarr; <b>${money(oldAfter.payroll)}</b>` : ''}</td></tr>
      <tr><td>New manager ${nm(newId)}</td>
          <td class="num">${newBefore ? newBefore.headcount : '&mdash;'}${newAfter ? ` &rarr; <b>${newAfter.headcount}</b>` : ''}</td>
          <td class="num">${newBefore ? money(newBefore.payroll) : '&mdash;'}${newAfter ? ` &rarr; <b>${money(newAfter.payroll)}</b>` : ''}</td></tr>
    </table>`;

  const box = $('attempts');
  box.innerHTML = attempts.map((a, i) => {
    const head = `<div class="a-head">
      <span class="a-no">Transfer ${i + 1}</span>
      <span class="a-move">${nm(a.employeeId)} &rarr; ${nm(a.newManagerId)}</span>
      <span class="a-tag ${a.ok ? 'ok' : 'no'}">${a.ok ? '\u2713 ACCEPTED' : '\u2715 REJECTED \u2014 ' + a.code}</span>
    </div>`;

    if (a.ok) {
      const rb = a.before.get(a.rootId), ra = a.after.get(a.rootId);
      return `<div class="attempt ok">${head}
        <p class="a-line">Moved <b>${ppl(a.movedSubtree.headcount)}</b> worth
          <b>${money(a.movedSubtree.payroll)}</b> from <b>${a.oldManagerId}</b> to <b>${a.newManagerId}</b>.</p>
        ${mgrPair('Before &rarr; after', a.oldManagerId, a.newManagerId,
                  a.before.get(a.oldManagerId), a.after.get(a.oldManagerId),
                  a.before.get(a.newManagerId), a.after.get(a.newManagerId))}
        <p class="a-foot">Department head <b>${a.rootId}</b>: ${tot(rb)} &rarr; ${tot(ra)}
          &mdash; unchanged.</p></div>`;
    }

    return `<div class="attempt no">${head}
      <p class="a-line">${a.message}</p>
      ${a.wouldMove ? `<p class="a-line muted">Would have moved
        ${ppl(a.wouldMove.headcount)} worth ${money(a.wouldMove.payroll)}.</p>` : ''}
      ${mgrPair('Unchanged by this attempt', a.oldManagerId, a.newManagerId,
                a.oldMgrNow, null, a.newMgrNow, null)}
      <p class="a-foot no">Nothing moved. Both managers still hold exactly the totals above,
        and the chart is untouched.</p></div>`;
  }).join('');

  // The log sits below a tall tree, so scroll the newest entry into view --
  // otherwise a transfer looks like it did nothing.
  box.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderTable() {
  const rows = state.employees.map((e, i) => {
    const r = state.rollups.get(e.employee_id);
    const cls = [movedIds.has(e.employee_id) ? 'moved' : '', changedIds.has(e.employee_id) ? 'changed' : ''].join(' ');
    const mark = (movedIds.has(e.employee_id) ? ' \u25b2' : '') + (changedIds.has(e.employee_id) ? ' \u25cf' : '');
    return `<tr class="${cls}${e.employee_id === selectedId ? ' selected' : ''}">
      <td class="muted">${i}</td><td><b>${e.employee_id}</b>${mark}</td>
      <td>${e.name}</td><td>${e.role}</td>
      <td class="num">${money(e.monthly_salary)}</td>
      <td>${e.manager_id ?? '\u2014'}</td>
      <td class="num">${r.headcount}</td><td class="num">${money(r.payroll)}</td>
    </tr>`;
  }).join('');
  $('table').innerHTML =
    `<tr><th>#</th><th>ID</th><th>Name</th><th>Role</th><th class="num">Salary</th>
      <th>Manager</th><th class="num">Team</th><th class="num">Team payroll</th></tr>${rows}`;
}

function doTransfer(employeeId, newManagerId) {
  const msg = $('transfer-msg');
  msg.hidden = false;

  // Read what WOULD move, and both managers' totals, from the CURRENT tree --
  // before anything changes. On a rejection these are the numbers that prove
  // nothing moved.
  const known = state.ix.byId.has(employeeId);
  const moving = known ? subtreeIds(state.ix, employeeId) : [];
  const oldManagerId = known ? state.ix.byId.get(employeeId).manager_id : null;
  const snapshot = (id) => (id && state.rollups.has(id) ? { ...state.rollups.get(id) } : null);

  const result = applyTransfer(state, employeeId, newManagerId);

  if (!result.ok) {
    // Rejected: chart, totals and every earlier log entry stay as they were.
    // We record the attempt and show why, but change nothing else.
    attempts.push({
      ok: false, employeeId, newManagerId, oldManagerId,
      code: result.error.code, message: result.error.message,
      oldMgrNow: snapshot(oldManagerId), newMgrNow: snapshot(newManagerId),
      wouldMove: known ? { ...state.rollups.get(employeeId) } : null,
    });
    msg.className = 'msg error';
    msg.textContent = `Rejected — ${result.error.code}: ${result.error.message}`;
    renderAttempts();
    return;
  }

  attempts.push({
    ok: true, employeeId, newManagerId, oldManagerId: result.oldManagerId,
    movedSubtree: result.movedSubtree, changedRollupIds: result.changedRollupIds,
    before: result.before, after: result.after, rootId: state.ix.rootId,
  });

  state = result.state;
  movedIds = new Set(moving);
  changedIds = new Set(result.changedRollupIds);
  msg.className = 'msg ok';
  msg.textContent = `Applied — ${employeeId} now reports to ${newManagerId}.`;
  render();
}

// ---------------------------------------------------------------- wiring
$('btn-load').onclick   = () => loadRecords(DEPARTMENT);
$('btn-solo').onclick   = () => loadRecords(SOLO);
$('btn-broken').onclick = () => loadRecords(BROKEN_DUPLICATE);
$('btn-reset').onclick  = () => { $('transfer-msg').hidden = true; loadRecords(records, { remember: false }); };

$('btn-transfer').onclick   = () => doTransfer($('sel-employee').value, $('sel-manager').value);
$('btn-demo-valid').onclick = () => doTransfer(DEMO_TRANSFER.employee_id,  DEMO_TRANSFER.new_manager_id);
$('btn-demo-cycle').onclick = () => doTransfer(DEMO_CYCLE.employee_id,     DEMO_CYCLE.new_manager_id);
$('btn-demo-root').onclick  = () => doTransfer(DEMO_ROOT_MOVE.employee_id, DEMO_ROOT_MOVE.new_manager_id);

loadRecords(DEPARTMENT);   // load in one action

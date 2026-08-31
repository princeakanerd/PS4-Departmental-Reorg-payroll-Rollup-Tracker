import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { CODES } from '../src/engine/codes.js';
import { buildIndexes, childrenOf, validate } from '../src/engine/validate.js';
import { load, applyTransfer, subtreeIds } from '../src/engine/transfer.js';
import { DEPARTMENT, SOLO, BROKEN_DUPLICATE, DEMO_TRANSFER, DEMO_CYCLE, DEMO_ROOT_MOVE }
  from '../src/data/department.js';
import * as EXPECTED from './fixtures/expected.js';

const pair = (r) => [r.headcount, r.payroll];
const totals = (s) => Object.fromEntries(s.employees.map(e => [e.employee_id, pair(s.rollups.get(e.employee_id))]));
const fresh = () => load(DEPARTMENT);

// ---------------------------------------------------------------- rollups
test('leaf totals: headcount 1, payroll == own salary', () => {
  const s = fresh();
  for (const e of s.employees) {
    if (childrenOf(s.ix, e.employee_id).length) continue;
    assert.deepEqual(pair(s.rollups.get(e.employee_id)), [1, e.monthly_salary]);
  }
});

test('multi-level totals match the hand-worked sheet', () => {
  assert.deepEqual(totals(fresh()), EXPECTED.INITIAL);
});

test('root invariants I1 and I2', () => {
  const s = fresh();
  const root = s.rollups.get(s.ix.rootId);
  assert.equal(root.headcount, s.employees.length);
  assert.equal(root.headcount, EXPECTED.HEADCOUNT);
  assert.equal(root.payroll, s.employees.reduce((a, e) => a + e.monthly_salary, 0));
  assert.equal(root.payroll, EXPECTED.TOTAL_SALARY);
});

test('one-person department: headcount 1, payroll == salary', () => {
  const s = load(SOLO);
  assert.ok(s.ok);
  assert.deepEqual(pair(s.rollups.get('SOLO')), [1, 99999]);
});

test('manager references resolve by id, not source position', () => {
  const shuffled = [...DEPARTMENT].reverse();      // children now precede managers
  assert.deepEqual(load(shuffled).rollups.get('DHEAD'), load(DEPARTMENT).rollups.get('DHEAD'));
});

// ---------------------------------------------------------------- transfer
test('valid transfer reproduces the documented post-move totals', () => {
  const tr = applyTransfer(fresh(), DEMO_TRANSFER.employee_id, DEMO_TRANSFER.new_manager_id);
  assert.ok(tr.ok);
  assert.deepEqual(totals(tr.state), EXPECTED.AFTER_TRANSFER);
  assert.equal(tr.oldManagerId, EXPECTED.OLD_MANAGER);
  assert.equal(tr.newManagerId, EXPECTED.NEW_MANAGER);
  assert.deepEqual(pair(tr.movedSubtree), [EXPECTED.MOVED_SUBTREE.headcount, EXPECTED.MOVED_SUBTREE.payroll]);
});

test('moved team stays intact', () => {
  const s = fresh();
  const beforeTeam = subtreeIds(s.ix, 'LEAD_CV').sort();
  const tr = applyTransfer(s, 'LEAD_CV', 'LABM');
  assert.deepEqual(subtreeIds(tr.state.ix, 'LEAD_CV').sort(), beforeTeam);
  assert.deepEqual(pair(tr.state.rollups.get('LEAD_CV')), pair(s.rollups.get('LEAD_CV')));
});

test('changed list matches the documented ids', () => {
  const s = fresh();
  const tr = applyTransfer(s, 'LEAD_CV', 'LABM');
  assert.deepEqual(tr.changedRollupIds, EXPECTED.CHANGED_ROLLUP_IDS);
  assert.ok(!tr.changedRollupIds.includes('DHEAD'), 'the head is not financially affected');
});

test('sibling order is source order, before and after', () => {
  const s = fresh();
  assert.deepEqual(childrenOf(s.ix, 'PGM'), EXPECTED.PGM_CHILDREN_BEFORE);
  assert.deepEqual(childrenOf(s.ix, 'LABM'), EXPECTED.LABM_CHILDREN_BEFORE);
  const tr = applyTransfer(s, 'LEAD_CV', 'LABM');
  assert.deepEqual(childrenOf(tr.state.ix, 'PGM'), EXPECTED.PGM_CHILDREN_AFTER);
  assert.deepEqual(childrenOf(tr.state.ix, 'LABM'), EXPECTED.LABM_CHILDREN_AFTER);
});

test('cycle rejected before AND after the valid transfer', () => {
  const s = fresh();
  const before = applyTransfer(s, DEMO_CYCLE.employee_id, DEMO_CYCLE.new_manager_id);
  assert.equal(before.error.code, CODES.MANAGEMENT_CYCLE);
  const moved = applyTransfer(s, 'LEAD_CV', 'LABM').state;
  const after = applyTransfer(moved, DEMO_CYCLE.employee_id, DEMO_CYCLE.new_manager_id);
  assert.equal(after.error.code, CODES.MANAGEMENT_CYCLE);
});

test('root is protected', () => {
  assert.equal(applyTransfer(fresh(), DEMO_ROOT_MOVE.employee_id, DEMO_ROOT_MOVE.new_manager_id).error.code,
    CODES.ROOT_MOVE_FORBIDDEN);
});

test('rejection checks run in the documented order', () => {
  const s = fresh();
  const code = (a, b) => applyTransfer(s, a, b).error.code;
  assert.equal(code('NOPE', 'DHEAD'), CODES.UNKNOWN_TRANSFER_EMPLOYEE);
  assert.equal(code('DHEAD', 'DHEAD'), CODES.ROOT_MOVE_FORBIDDEN);      // root beats self
  assert.equal(code('PGM', 'PGM'), CODES.SELF_MANAGER);
  assert.equal(code('LEAD_CV', 'PGM'), CODES.ALREADY_REPORTS_TO_MANAGER);
  assert.equal(code('PGM', 'RA_NAIR'), CODES.MANAGEMENT_CYCLE);
});

test('a rejection changes nothing', () => {
  const s = fresh();
  const snapshot = JSON.stringify([s.employees, totals(s)]);
  for (const [a, b] of [['NOPE', 'DHEAD'], ['DHEAD', 'LABM'], ['PGM', 'PGM'],
  ['LEAD_CV', 'PGM'], ['PGM', 'RA_NAIR']]) {
    const tr = applyTransfer(s, a, b);
    assert.ok(!tr.ok);
    assert.equal(tr.state, s, 'rejection returns the very same state object');
  }
  assert.equal(JSON.stringify([s.employees, totals(s)]), snapshot);
});

test('reset then the same transfer again gives an identical result', () => {
  const first = applyTransfer(fresh(), 'LEAD_CV', 'LABM');
  const again = applyTransfer(fresh(), 'LEAD_CV', 'LABM');   // fresh() == what reset restores
  assert.deepEqual(totals(again.state), totals(first.state));
  assert.deepEqual(again.changedRollupIds, first.changedRollupIds);
  assert.deepEqual(totals(fresh()), EXPECTED.INITIAL);
});

// ---------------------------------------------------------------- bad loads
test('bad load — duplicate id', () => {
  const s = load(BROKEN_DUPLICATE);
  assert.equal(s.error.code, CODES.DUPLICATE_EMPLOYEE_ID);
  assert.match(s.error.message, /PGM/);
});

test('bad load — unknown manager', () => {
  const recs = DEPARTMENT.map(e => e.employee_id === 'RA_IYER' ? { ...e, manager_id: 'GHOST' } : e);
  const s = load(recs);
  assert.equal(s.error.code, CODES.UNKNOWN_MANAGER);
  assert.match(s.error.message, /GHOST/);
});

test('bad load — cycle, message names the members', () => {
  const recs = DEPARTMENT.map(e => e.employee_id === 'LEAD_CV' ? { ...e, manager_id: 'RA_IYER' } : e);
  const s = load(recs);
  assert.equal(s.error.code, CODES.MANAGEMENT_CYCLE);
  assert.match(s.error.message, /LEAD_CV/);
  assert.match(s.error.message, /RA_IYER/);
});

test('bad load — other structural failures', () => {
  const two = DEPARTMENT.map(e => e.employee_id === 'PGM' ? { ...e, manager_id: null } : e);
  assert.equal(load(two).error.code, CODES.INVALID_ROOT_COUNT);
  const self = DEPARTMENT.map(e => e.employee_id === 'PGM' ? { ...e, manager_id: 'PGM' } : e);
  assert.equal(load(self).error.code, CODES.SELF_MANAGER);
  assert.equal(load([]).error.code, CODES.INVALID_EMPLOYEE);
  assert.equal(load(DEPARTMENT.map(e => ({ ...e, monthly_salary: 0 }))).error.code, CODES.INVALID_EMPLOYEE);
  assert.equal(load([{ ...DEPARTMENT[0], employee_id: 'lower' }]).error.code, CODES.INVALID_EMPLOYEE);
  assert.equal(load([{ ...DEPARTMENT[0], name: '   ' }]).error.code, CODES.INVALID_EMPLOYEE);
});

test('error precedence: category order first, then source order', () => {
  // duplicate id (record 2) AND unknown manager (record 1) -> duplicate wins
  const both = [
    { employee_id: 'DHEAD', name: 'A', role: 'Head', monthly_salary: 100, manager_id: null },
    { employee_id: 'X', name: 'B', role: 'R', monthly_salary: 100, manager_id: 'GHOST' },
    { employee_id: 'X', name: 'C', role: 'R', monthly_salary: 100, manager_id: 'DHEAD' },
  ];
  assert.equal(load(both).error.code, CODES.DUPLICATE_EMPLOYEE_ID);

  // self@1 and unknown@2 -> source order picks self
  const selfFirst = [
    { employee_id: 'DHEAD', name: 'A', role: 'Head', monthly_salary: 100, manager_id: null },
    { employee_id: 'P', name: 'B', role: 'R', monthly_salary: 100, manager_id: 'P' },
    { employee_id: 'Q', name: 'C', role: 'R', monthly_salary: 100, manager_id: 'GHOST' },
  ];
  assert.equal(load(selfFirst).error.code, CODES.SELF_MANAGER);

  // unknown@1 and self@2 -> source order picks unknown
  const unknownFirst = [
    { employee_id: 'DHEAD', name: 'A', role: 'Head', monthly_salary: 100, manager_id: null },
    { employee_id: 'P', name: 'B', role: 'R', monthly_salary: 100, manager_id: 'GHOST' },
    { employee_id: 'Q', name: 'C', role: 'R', monthly_salary: 100, manager_id: 'Q' },
  ];
  assert.equal(load(unknownFirst).error.code, CODES.UNKNOWN_MANAGER);
});

test('a failed load carries no tree and no totals', () => {
  const s = load(BROKEN_DUPLICATE);
  assert.equal(s.ok, false);
  assert.equal(s.ix, null);
  assert.equal(s.employees.length, 0);
  assert.equal(s.rollups.size, 0);
});

// ---------------------------------------------------------------- quarantine
test('no src/ file imports the expected answers', () => {
  const walk = (dir) => readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  // Check what src/ IMPORTS, not what it says. The word "expected" appears in
  // validation messages legitimately; an import of the answer sheet never can.
  const IMPORT_RE = /(?:^|\s)(?:import|export)[^;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]/g;
  for (const f of walk('src')) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2];
      assert.ok(!/expected|tests?\//i.test(spec),
        `${f} imports '${spec}' — src/ must never read the hand-worked answers`);
    }
  }
});

// ---------------------------------------------------------------- second opinions
// Both live here, not in src/: they exist only to check the shipped engine from
// a different direction. The app never needs them.

// §5.2 — same totals without recursion: level-order down, then add each person
// into their manager on the way back up.
function rollupsIterative(employees, ix) {
  const order = [ix.rootId];
  for (let h = 0; h < order.length; h++) for (const c of childrenOf(ix, order[h])) order.push(c);

  const r = new Map(employees.map(e => [e.employee_id, { headcount: 0, payroll: 0 }]));
  for (let i = order.length - 1; i >= 0; i--) {      // REVERSED: children first
    const e = ix.byId.get(order[i]), me = r.get(order[i]);
    me.headcount += 1;
    me.payroll += e.monthly_salary;
    if (e.manager_id !== null) {
      const boss = r.get(e.manager_id);
      boss.headcount += me.headcount;
      boss.payroll += me.payroll;
    }
  }
  return r;
}

// §7.3 — only the two chains between each manager and their fork point can change.
function predictChangedByForkPoint(ix, oldBoss, newBoss) {
  const chain = (start) => {
    const out = [];
    for (let cur = start; cur !== null; cur = ix.byId.get(cur).manager_id) out.push(cur);
    return out;
  };
  const a = chain(oldBoss), b = chain(newBoss);
  const inB = new Set(b);
  const fork = a.find(x => inB.has(x));
  return [...a.slice(0, a.indexOf(fork)), ...b.slice(0, b.indexOf(fork))];
}

test('recursive rollups match the non-recursive method', () => {
  const s = fresh();
  const alt = rollupsIterative(s.employees, s.ix);
  for (const e of s.employees)
    assert.deepEqual(pair(s.rollups.get(e.employee_id)), pair(alt.get(e.employee_id)));
});

test('changed list matches the fork-point prediction', () => {
  const s = fresh();
  const tr = applyTransfer(s, 'LEAD_CV', 'LABM');
  assert.deepEqual(predictChangedByForkPoint(s.ix, tr.oldManagerId, tr.newManagerId).sort(),
    [...EXPECTED.CHANGED_ROLLUP_IDS].sort());
});

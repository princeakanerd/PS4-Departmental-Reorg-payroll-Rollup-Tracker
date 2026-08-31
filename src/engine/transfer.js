// §4.5 app state, §6 the transfer, §7 which totals changed.

import { CODES, OK, fail } from './codes.js';
import { validate, buildIndexes, childrenOf } from './validate.js';
import { computeRollups, sameRollup } from './rollup.js';

// §4.5 — load always returns a WHOLE new state. A failed load therefore carries
// no tree and no rollups, so stale results from an earlier department cannot
// survive; there is nothing to leave behind.
export function load(records) {
  const error = validate(records);
  if (error !== OK) return { ok: false, error, employees: [], rollups: new Map(), ix: null };

  const employees = records.map(e => ({ ...e }));   // own the records; never alias the caller's
  const ix = buildIndexes(employees);
  return { ok: true, error: OK, employees, ix, rollups: computeRollups(employees, ix) };
}

// §6.3 — is `boss` at or above `person`? Walk UP from person; the chain to the
// root is at most 30 long and cannot loop, because the tree is already valid.
export function isAncestor(ix, boss, person) {
  let cur = person;
  for (;;) {
    if (cur === boss) return true;
    const m = ix.byId.get(cur).manager_id;
    if (m === null) return false;
    cur = m;
  }
}

// §6.2 — the five checks, in exactly this order. All of them run against the
// CURRENT state and mutate nothing, so a rejection is atomic by construction:
// we return before any new state is built.
function rejectionFor(s, employeeId, newManagerId) {
  if (!s.ix.byId.has(employeeId) || !s.ix.byId.has(newManagerId))
    return fail(CODES.UNKNOWN_TRANSFER_EMPLOYEE,
      `unknown employee or manager id ('${employeeId}' -> '${newManagerId}')`);

  if (employeeId === s.ix.rootId)
    return fail(CODES.ROOT_MOVE_FORBIDDEN, `cannot move the department head '${employeeId}'`);

  if (employeeId === newManagerId)
    return fail(CODES.SELF_MANAGER, `'${employeeId}' cannot manage themself`);

  if (s.ix.byId.get(employeeId).manager_id === newManagerId)
    return fail(CODES.ALREADY_REPORTS_TO_MANAGER,
      `'${employeeId}' already reports to '${newManagerId}'`);

  if (isAncestor(s.ix, employeeId, newManagerId))
    return fail(CODES.MANAGEMENT_CYCLE, `'${newManagerId}' is inside '${employeeId}' team`);

  return OK;
}

export function applyTransfer(s, employeeId, newManagerId) {
  const error = rejectionFor(s, employeeId, newManagerId);
  if (error !== OK) return { ok: false, error, state: s };   // caller's state, untouched

  const before = s.rollups;
  const oldManagerId = s.ix.byId.get(employeeId).manager_id;
  const movedSubtree = before.get(employeeId);

  // §6.4 — the whole move: one field, on a COPY of the records. Every
  // descendant record is untouched, which is exactly why the team comes along.
  const employees = s.employees.map(e =>
    e.employee_id === employeeId ? { ...e, manager_id: newManagerId } : e);

  const ix = buildIndexes(employees);          // report lists rebuilt in source order
  const after = computeRollups(employees, ix);

  // §7.1 — compare everyone, before vs after. Iterating the source array gives
  // source order for free.
  const changedRollupIds = employees
    .map(e => e.employee_id)
    .filter(id => !sameRollup(before.get(id), after.get(id)));

  return {
    ok: true, error: OK,
    state: { ok: true, error: OK, employees, ix, rollups: after },
    employeeId, oldManagerId, newManagerId, movedSubtree, changedRollupIds, before, after,
  };
}

// The subtree under (and including) an id, for highlighting the moved team.
export function subtreeIds(ix, id) {
  const out = [], stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    out.push(cur);
    for (const c of childrenOf(ix, cur)) stack.push(c);
  }
  return out;
}

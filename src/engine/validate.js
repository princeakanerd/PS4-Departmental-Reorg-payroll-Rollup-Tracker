// §2.2 indexes + §4 validation.

import { CODES, OK, fail } from './codes.js';

// ---------------------------------------------------------------- §2.2
// Derived lookups, rebuilt from scratch on every state change. Never stored
// across one, so they can never drift from the records they describe.
export function buildIndexes(employees) {
  const byId = new Map();
  const kids = new Map();
  let rootId = null;

  for (const e of employees) byId.set(e.employee_id, e);

  for (const e of employees) {              // <-- walk in SOURCE ORDER
    if (e.manager_id === null) { rootId = e.employee_id; continue; }
    if (!kids.has(e.manager_id)) kids.set(e.manager_id, []);
    kids.get(e.manager_id).push(e.employee_id);   // <-- push keeps that order
  }
  return { byId, kids, rootId };
}

// Every manager's report list is already in source order, for free.
export const childrenOf = (ix, id) => ix.kids.get(id) ?? [];

// ---------------------------------------------------------------- §4.2 step 1

// Id_re says that employee id must start with a Capital letter and can have  capital letters, numbers, hyphens and underscores.
// It cannot be longer than 16 characters.
const ID_RE = /^[A-Z][A-Z0-9_-]{0,15}$/;


const trimmed = (v) => (typeof v === 'string' ? v.trim() : '');

function checkCountAndFields(es) {

  if (!Array.isArray(es) || es.length < 1 || es.length > 30)
    return fail(CODES.INVALID_EMPLOYEE,
      `employee count ${Array.isArray(es) ? es.length : '?'} outside 1..30`);

  for (let i = 0; i < es.length; i++) {
    //e is that complete employee record and at is just to show that it failed at this this particular record.

    const e = es[i], at = ` at record ${i}`;

    //Validate employee id is strin and follows the regex 
    if (typeof e?.employee_id !== 'string' || !ID_RE.test(e.employee_id))
      return fail(CODES.INVALID_EMPLOYEE, `malformed employee_id '${e?.employee_id}'${at}`);

    // name and role must not be empty
    if (trimmed(e.name) === '') return fail(CODES.INVALID_EMPLOYEE, `empty name${at}`);
    if (trimmed(e.role) === '') return fail(CODES.INVALID_EMPLOYEE, `empty role${at}`);

    //Assumption: salaries are always integers and in range 1 to 1000000.
    if (!Number.isInteger(e.monthly_salary) || e.monthly_salary < 1 || e.monthly_salary > 1000000)
      return fail(CODES.INVALID_EMPLOYEE, `salary ${e.monthly_salary} outside 1..1000000${at}`);

    //manager id can be null for HOD , But if its not null then must be a string
    if (e.manager_id !== null && typeof e.manager_id !== 'string')
      return fail(CODES.INVALID_EMPLOYEE, `manager_id must be null or an id${at}`);
  }
  return OK;
}

// ---------------------------------------------------------------- §4.2 step 2
function checkDuplicateIds(es) {
  const firstSeen = new Map();
  for (let i = 0; i < es.length; i++) {
    const id = es[i].employee_id;
    if (firstSeen.has(id))
      return fail(CODES.DUPLICATE_EMPLOYEE_ID,
        `employee_id '${id}' appears at records ${firstSeen.get(id)} and ${i}`);
    firstSeen.set(id, i);
  }
  return OK;
}

// ---------------------------------------------------------------- §4.2 step 3
// Checks if exactly one person has no manager (HOD)
function checkRootCount(es) {
  const roots = es.filter(e => e.manager_id === null).map(e => e.employee_id);
  if (roots.length !== 1)
    return fail(CODES.INVALID_ROOT_COUNT,
      `expected exactly 1 department head, found ${roots.length}` +
      (roots.length ? ` [${roots.join(', ')}]` : ''));
  return OK;
}

// ---------------------------------------------------------------- §4.2 step 4
// ONE loop, both conditions per record, so source order breaks the tie.
function checkManagerReferences(es) {
  const ids = new Set(es.map(e => e.employee_id));
  for (let i = 0; i < es.length; i++) {
    const e = es[i];
    //If manager id is null then must be the HOD
    if (e.manager_id === null) continue;
    if (e.manager_id === e.employee_id)
      return fail(CODES.SELF_MANAGER, `'${e.employee_id}' manages themself at record ${i}`);
    // Manager must exist in the records
    if (!ids.has(e.manager_id))
      return fail(CODES.UNKNOWN_MANAGER,
        `'${e.employee_id}' at record ${i} references unknown manager '${e.manager_id}'`);
  }
  return OK;
}

// ---------------------------------------------------------------- §4.4
// Walk up from someone stranded until a node repeats; that repeat starts the loop.
function describeCycle(ix, start) {
  const seen = [], pos = new Map();
  let cur = start;
  while (!pos.has(cur)) {
    pos.set(cur, seen.length);
    seen.push(cur);
    const m = ix.byId.get(cur).manager_id;
    if (m === null) return '';
    cur = m;
  }
  return [...seen.slice(pos.get(cur)), cur].join(' -> ');
}

// ---------------------------------------------------------------- §4.3 step 5
// Walk DOWN from the root. Anyone unreached could not walk UP to the root,
// which — every arrow being valid and the department finite — means a cycle.
function checkSingleConnectedTree(es) {
  const ix = buildIndexes(es);
  const visited = new Set();
  const stack = [ix.rootId];
  while (stack.length) {
    const cur = stack.pop();
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const c of childrenOf(ix, cur)) stack.push(c);
  }
  if (visited.size === es.length) return OK;

  const stranded = es.find(e => !visited.has(e.employee_id));
  return fail(CODES.MANAGEMENT_CYCLE,
    `reporting cycle: ${describeCycle(ix, stranded.employee_id)}`);
}

// ---------------------------------------------------------------- §4.1
// A pipeline, not a preference: each check needs the previous one to have
// passed. First failure wins and we stop immediately.
const CHECKS = [
  checkCountAndFields,      // step 1
  checkDuplicateIds,        // step 2
  checkRootCount,           // step 3
  checkManagerReferences,   // step 4 (self AND unknown together)
  checkSingleConnectedTree, // step 5
];

export function validate(employees) {
  for (const check of CHECKS) {
    const err = check(employees);
    if (err !== OK) return err;
  }
  return OK;
}

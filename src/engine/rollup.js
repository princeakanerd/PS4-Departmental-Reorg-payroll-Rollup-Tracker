// §5 — team rollups, and the §3 invariants that police them.

import { childrenOf } from './validate.js';

// §3 — if one of these fails it is a bug in this file, not an edge case.
function assertInvariants(employees, rollups, rootId) {
  // This function just mathematically verifies if the total headcout and the total payroll actually matches the given input

  const total = employees.reduce((s, e) => s + e.monthly_salary, 0);
  const root = rollups.get(rootId);
  if (root.headcount !== employees.length)                       // I1
    throw new Error(`invariant I1: root headcount ${root.headcount} != ${employees.length}`);
  if (root.payroll !== total)                                    // I2
    throw new Error(`invariant I2: root payroll ${root.payroll} != ${total}`);
}

// §5.1 — post-order: a manager's total needs every child's total first.
function rollupRec(id, ix, out) {
  //just a simple DFS function

  // e is the complete employee object
  const e = ix.byId.get(id);
  let headcount = 1;
  let payroll = e.monthly_salary;

  for (const c of childrenOf(ix, id)) {
    const cr = rollupRec(c, ix, out);
    headcount += cr.headcount;
    payroll += cr.payroll;
  }
  const r = { headcount, payroll };
  out.set(id, r);
  return r;
}

export function computeRollups(employees, ix) {
  const out = new Map();
  rollupRec(ix.rootId, ix, out);
  assertInvariants(employees, out, ix.rootId);
  return out;
}

//This is just to combine 2 rollup objects whether they are the same or not

export const sameRollup = (a, b) => a.headcount === b.headcount && a.payroll === b.payroll;

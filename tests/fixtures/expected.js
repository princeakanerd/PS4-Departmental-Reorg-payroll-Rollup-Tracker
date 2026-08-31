// HAND-WORKED ANSWERS. TESTS ONLY — nothing under src/ may import this file.
// (tests/engine.test.js enforces that with a scan.)
//
// Worked out on paper from the §5 rule (team totals include yourself), then
// cross-checked against reference/rollup.cpp, a separate C++ program that
// shares no code with the JavaScript engine under test.
//
//   DHEAD 165000
//   |- PGM 92000
//   |  |- LEAD_CV 74000      |- RA_IYER 43000   |- RA_BOSE 39000
//   |  |- LEAD_NLP 71000     |- RA_NAIR 41000
//   |- LABM 88000            |- TECH_DEY 36000  |- TECH_RAM 34000
//   |- ADMIN 64000           |- CLERK_JOE 28000
//
// Salary sum, added by hand:
//   165000 + 92000 + 88000 + 64000 + 74000 + 71000
//     + 43000 + 39000 + 41000 + 36000 + 34000 + 28000  =  775000

export const TOTAL_SALARY = 775000;
export const HEADCOUNT = 12;

// [headcount, payroll], in source order.
//   leaves       : 1 / own salary
//   LEAD_CV      : 74000 + 43000 + 39000            = 156000, 3 people
//   LEAD_NLP     : 71000 + 41000                    = 112000, 2 people
//   PGM          : 92000 + 156000 + 112000          = 360000, 6 people
//   LABM         : 88000 + 36000 + 34000            = 158000, 3 people
//   ADMIN        : 64000 + 28000                    =  92000, 2 people
//   DHEAD        : 165000 + 360000 + 158000 + 92000 = 775000, 12 people
export const INITIAL = {
  DHEAD:     [12, 775000],
  PGM:       [ 6, 360000],
  LABM:      [ 3, 158000],
  ADMIN:     [ 2,  92000],
  LEAD_CV:   [ 3, 156000],
  LEAD_NLP:  [ 2, 112000],
  RA_IYER:   [ 1,  43000],
  RA_BOSE:   [ 1,  39000],
  RA_NAIR:   [ 1,  41000],
  TECH_DEY:  [ 1,  36000],
  TECH_RAM:  [ 1,  34000],
  CLERK_JOE: [ 1,  28000],
};

// After moving LEAD_CV (and its 2 research assistants) from PGM to LABM:
//   PGM  loses that 3-person, 156000 team : 6/360000 -> 3/204000
//   LABM gains it                         : 3/158000 -> 6/314000
//   DHEAD unchanged — the 3 people were in the department before and after.
export const AFTER_TRANSFER = {
  ...INITIAL,
  PGM:  [3, 204000],
  LABM: [6, 314000],
};

export const MOVED_SUBTREE = { headcount: 3, payroll: 156000 };
export const OLD_MANAGER = 'PGM';
export const NEW_MANAGER = 'LABM';

// Exactly the two managers above, in source order (PGM is record 1, LABM is 2).
export const CHANGED_ROLLUP_IDS = ['PGM', 'LABM'];

// Source order for LABM's reports afterwards. LEAD_CV is record 4 and the two
// technicians are records 9 and 10, so the arrival lands FIRST, not appended.
export const LABM_CHILDREN_AFTER = ['LEAD_CV', 'TECH_DEY', 'TECH_RAM'];
export const PGM_CHILDREN_AFTER  = ['LEAD_NLP'];

// Source order before the move.
export const PGM_CHILDREN_BEFORE  = ['LEAD_CV', 'LEAD_NLP'];
export const LABM_CHILDREN_BEFORE = ['TECH_DEY', 'TECH_RAM'];

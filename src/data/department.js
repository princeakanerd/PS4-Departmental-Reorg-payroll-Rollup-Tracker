// The 12-employee demonstration department (D3). Real operational input.
//
// Shape conditions it satisfies:
//   1 department head (DHEAD) with 3 branches below (PGM, LABM, ADMIN)
//   5 employees have direct reports (DHEAD, PGM, LABM, ADMIN, LEAD_CV, LEAD_NLP)
//   LEAD_CV is a non-leaf lead with 2 descendants, movable between branches
//   RA_IYER sits 3 reporting links below the head (DHEAD > PGM > LEAD_CV > RA_IYER)
//   all 12 salaries differ
//
// Records are deliberately NOT in manager-first order (LEAD_CV appears before
// its manager's other reports, CLERK_JOE last) to prove §2.2 resolves manager
// references by id rather than by position.

export const DEPARTMENT = [
  { employee_id: 'DHEAD',     name: 'Asha Rao',       role: 'Department Head',       monthly_salary: 165000, manager_id: null },
  { employee_id: 'PGM',       name: 'Bhavna Iyer',    role: 'Programme Manager',     monthly_salary:  92000, manager_id: 'DHEAD' },
  { employee_id: 'LABM',      name: 'Chetan Das',     role: 'Laboratory Manager',    monthly_salary:  88000, manager_id: 'DHEAD' },
  { employee_id: 'ADMIN',     name: 'Devika Menon',   role: 'Administrative Officer',monthly_salary:  64000, manager_id: 'DHEAD' },
  { employee_id: 'LEAD_CV',   name: 'Farhan Qureshi', role: 'Vision Lab Lead',       monthly_salary:  74000, manager_id: 'PGM' },
  { employee_id: 'LEAD_NLP',  name: 'Gita Pillai',    role: 'Language Lab Lead',     monthly_salary:  71000, manager_id: 'PGM' },
  { employee_id: 'RA_IYER',   name: 'Harsh Iyer',     role: 'Research Assistant',    monthly_salary:  43000, manager_id: 'LEAD_CV' },
  { employee_id: 'RA_BOSE',   name: 'Ipsita Bose',    role: 'Research Assistant',    monthly_salary:  39000, manager_id: 'LEAD_CV' },
  { employee_id: 'RA_NAIR',   name: 'Jaya Nair',      role: 'Research Assistant',    monthly_salary:  41000, manager_id: 'LEAD_NLP' },
  { employee_id: 'TECH_DEY',  name: 'Kabir Dey',      role: 'Lab Technician',        monthly_salary:  36000, manager_id: 'LABM' },
  { employee_id: 'TECH_RAM',  name: 'Lata Ramesh',    role: 'Lab Technician',        monthly_salary:  34000, manager_id: 'LABM' },
  { employee_id: 'CLERK_JOE', name: 'Manav Joseph',   role: 'Office Clerk',          monthly_salary:  28000, manager_id: 'ADMIN' },
];

// A valid one-person department: headcount 1, payroll == its own salary.
export const SOLO = [
  { employee_id: 'SOLO', name: 'Nita Verma', role: 'Visiting Faculty', monthly_salary: 99999, manager_id: null },
];

// Deliberately broken: RA_BOSE's id is reused. Demonstrates that a failed load
// clears the previous department instead of showing a partial tree.
export const BROKEN_DUPLICATE = [
  { employee_id: 'DHEAD',   name: 'Asha Rao',    role: 'Department Head',    monthly_salary: 165000, manager_id: null },
  { employee_id: 'PGM',     name: 'Bhavna Iyer', role: 'Programme Manager',  monthly_salary:  92000, manager_id: 'DHEAD' },
  { employee_id: 'PGM',     name: 'Copy Paste',  role: 'Programme Manager',  monthly_salary:  92000, manager_id: 'DHEAD' },
];

// The two documented demonstration transfers.
export const DEMO_TRANSFER  = { employee_id: 'LEAD_CV', new_manager_id: 'LABM' };     // valid, cross-branch
export const DEMO_CYCLE     = { employee_id: 'PGM',     new_manager_id: 'RA_NAIR' };  // MANAGEMENT_CYCLE
export const DEMO_ROOT_MOVE = { employee_id: 'DHEAD',   new_manager_id: 'LABM' };     // ROOT_MOVE_FORBIDDEN

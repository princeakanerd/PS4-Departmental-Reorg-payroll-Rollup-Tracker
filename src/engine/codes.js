// stable error codes. The only place a code string is spelled out.

export const CODES = {
  // load-time 
  INVALID_EMPLOYEE: 'INVALID_EMPLOYEE',
  DUPLICATE_EMPLOYEE_ID: 'DUPLICATE_EMPLOYEE_ID',
  INVALID_ROOT_COUNT: 'INVALID_ROOT_COUNT',
  UNKNOWN_MANAGER: 'UNKNOWN_MANAGER',
  SELF_MANAGER: 'SELF_MANAGER',
  MANAGEMENT_CYCLE: 'MANAGEMENT_CYCLE',
  // transfer-time 
  UNKNOWN_TRANSFER_EMPLOYEE: 'UNKNOWN_TRANSFER_EMPLOYEE',
  ROOT_MOVE_FORBIDDEN: 'ROOT_MOVE_FORBIDDEN',
  ALREADY_REPORTS_TO_MANAGER: 'ALREADY_REPORTS_TO_MANAGER',
};

export const OK = null;                       // "no error"
export const fail = (code, message) => ({ code, message });

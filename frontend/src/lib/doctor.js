import { api } from './api.js';

const casePath = (caseId) => `/api/cases/${encodeURIComponent(caseId)}/doctor`;

export function checkCase(caseId) {
  return api.get(casePath(caseId));
}

export function repairCase(caseId, repair) {
  return api.post(`${casePath(caseId)}/repair`, repair);
}

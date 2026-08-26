const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/* Identity plus what it may do. `permissions` and `scope` are the server's own answer
 * to "what is this caller allowed to touch" — the UI reads them so it can stop asking
 * the user to type a companyId, which was the same as letting the caller pick their
 * own scope. The server re-checks everything regardless. */
export interface AuthUser {
  id: string;
  email: string;
  roles: string[];
  permissions: string[];
  /** Codes explicitly denied. Deny beats every grant — never render past this. */
  denied: string[];
  scope: {
    /** Broadest scope level held. SITE with an empty `siteIds` reaches nothing. */
    level: 'GROUP' | 'COMPANY' | 'SITE' | 'NONE';
    /** GROUP-scoped: no record restriction — every company, every cemetery. */
    unrestricted: boolean;
    companyIds: string[];
    /** Cemeteries this user covers — the hub axis. */
    siteIds: string[];
  };
}

// Tokens live in localStorage (skeleton). Production should use httpOnly cookies.
export function getToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.localStorage.getItem('accessToken');
}

export function setTokens(accessToken: string, refreshToken: string): void {
  window.localStorage.setItem('accessToken', accessToken);
  window.localStorage.setItem('refreshToken', refreshToken);
}

export function clearTokens(): void {
  window.localStorage.removeItem('accessToken');
  window.localStorage.removeItem('refreshToken');
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token !== null ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      message = body.error?.message ?? message;
    } catch {
      // non-JSON error body — keep statusText
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

// --- Auth API (contract from apps/api iam) ---

export async function authLogin(email: string, password: string): Promise<AuthUser> {
  const r = await apiFetch<{ accessToken: string; refreshToken: string; user: AuthUser }>(
    '/api/v1/auth/login',
    { method: 'POST', body: JSON.stringify({ email, password }) },
  );
  setTokens(r.accessToken, r.refreshToken);
  return r.user;
}

export function authMe(): Promise<AuthUser> {
  return apiFetch<AuthUser>('/api/v1/auth/me');
}

export async function authLogout(): Promise<void> {
  try {
    await apiFetch<void>('/api/v1/auth/logout', { method: 'POST' });
  } catch {
    // even if the call fails, drop local tokens
  }
  clearTokens();
}

// --- CRM (customers) ---

export interface CustomerPerson {
  id: string;
  fullName: string;
  gender: string | null;
  nationalIdMasked: string | null;
  dateOfBirth: string | null;
  placeOfBirth: string | null;
  /** Có bản ghi = đã mất. Không có = còn sống. Không phải cờ boolean riêng. */
  deceased: { dateOfDeath: string | null } | null;
}

export interface Customer360 {
  id: string;
  customerCode: string;
  type: string;
  orgName: string | null;
  phone: string | null;
  email: string | null;
  person: CustomerPerson | null;
  /** Mã các phần mộ đang đứng tên. API gom sẵn để bảng không phải gọi thêm mỗi dòng. */
  gravePlotCodes: string[];
  isDeceased: boolean;
}

export interface DedupWarning {
  reason: string;
  matches: unknown[];
}

export interface CreateCustomerInput {
  type: string;
  person?: {
    fullName: string;
    gender?: string;
    dateOfBirth?: string;
    nationalId?: string;
    nationalIdIssuedOn?: string;
    nationalIdIssuedPlace?: string;
    phone?: string;
    email?: string;
    permanentAddress?: string;
    contactAddress?: string;
    /* Dân tộc / tôn giáo — dữ liệu nhạy cảm theo NĐ13 Điều 2.4, chỉ người cầm
     * `crm.person.view_sensitive` đọc lại được bản không che. */
    ethnicity?: string;
    religion?: string;
  };
  orgName?: string;
  phone?: string;
  email?: string;
}

export function searchCustomers(q: string, deceasedOnly = false): Promise<Customer360[]> {
  /* `deceasedOnly` lọc ở SERVER: truy vấn cắt ở 50 dòng, nên lọc phía client sẽ bỏ sót
   * người đã mất khi danh sách có nhiều khách còn sống đứng trước. */
  return apiFetch<Customer360[]>(
    `/api/v1/crm/customers/search?q=${encodeURIComponent(q)}${deceasedOnly ? '&deceasedOnly=true' : ''}`,
  );
}

export function createCustomer(
  input: CreateCustomerInput,
): Promise<{ customer: Customer360; warnings: DedupWarning[] }> {
  return apiFetch('/api/v1/crm/customers', { method: 'POST', body: JSON.stringify(input) });
}

// --- Cemetery catalog + holds ---

export interface Company {
  id: string;
  code: string;
  name: string;
}
export interface Cemetery {
  id: string;
  code: string;
  name: string;
}
export interface GraveType {
  id: string;
  code: string;
  name: string;
  defaultCapacity: number;
}
export interface GravePlot {
  id: string;
  plotCode: string;
  status: string;
  effectiveCapacity: number;
  cemeteryId: string;
  graveTypeId: string;
}

export const listCompanies = (): Promise<Company[]> => apiFetch('/api/v1/cemetery/companies');
export const createCompany = (code: string, name: string): Promise<Company> =>
  apiFetch('/api/v1/cemetery/companies', { method: 'POST', body: JSON.stringify({ code, name }) });

export const listCemeteries = (companyId: string): Promise<Cemetery[]> =>
  apiFetch(`/api/v1/cemetery/cemeteries?companyId=${encodeURIComponent(companyId)}`);
export const createCemetery = (companyId: string, code: string, name: string): Promise<Cemetery> =>
  apiFetch('/api/v1/cemetery/cemeteries', {
    method: 'POST',
    body: JSON.stringify({ companyId, code, name }),
  });

export const listGraveTypes = (companyId: string): Promise<GraveType[]> =>
  apiFetch(`/api/v1/cemetery/grave-types?companyId=${encodeURIComponent(companyId)}`);
export const createGraveType = (
  companyId: string,
  code: string,
  name: string,
  defaultCapacity: number,
): Promise<GraveType> =>
  apiFetch('/api/v1/cemetery/grave-types', {
    method: 'POST',
    body: JSON.stringify({ companyId, code, name, defaultCapacity }),
  });

export const listGravePlots = (companyId: string): Promise<GravePlot[]> =>
  apiFetch(`/api/v1/cemetery/grave-plots?companyId=${encodeURIComponent(companyId)}`);
export const createGravePlot = (input: {
  companyId: string;
  cemeteryId: string;
  graveTypeId: string;
  plotCode: string;
}): Promise<GravePlot> =>
  apiFetch('/api/v1/cemetery/grave-plots', { method: 'POST', body: JSON.stringify(input) });

export interface GraveHold {
  id: string;
  gravePlotId: string;
  customerId: string;
  status: string;
  expiresAt: string;
}
export const createHold = (gravePlotId: string, customerId: string): Promise<GraveHold> =>
  apiFetch('/api/v1/cemetery/grave-holds', {
    method: 'POST',
    body: JSON.stringify({ gravePlotId, customerId }),
  });
export const listHolds = (gravePlotId: string, status: string): Promise<GraveHold[]> =>
  apiFetch(
    `/api/v1/cemetery/grave-holds?gravePlotId=${encodeURIComponent(gravePlotId)}&status=${status}`,
  );
export const releaseHold = (id: string): Promise<unknown> =>
  apiFetch(`/api/v1/cemetery/grave-holds/${id}/release`, { method: 'POST' });

// --- Files (MinIO presigned upload) ---

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

// Presign, PUT the file to MinIO, confirm. Returns the fileId to link (e.g. to a contract).
export async function uploadFile(file: File): Promise<string> {
  const presign = await apiFetch<{ fileId: string; uploadUrl: string }>(
    '/api/v1/files/presign-upload',
    {
      method: 'POST',
      body: JSON.stringify({
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
      }),
    },
  );
  const put = await fetch(presign.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!put.ok) {
    throw new ApiError(put.status, 'Upload lên storage thất bại');
  }
  await apiFetch(`/api/v1/files/${presign.fileId}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ sizeBytes: file.size }),
  });
  return presign.fileId;
}

export function fileDownloadUrl(fileId: string): Promise<{ url: string }> {
  return apiFetch(`/api/v1/files/${fileId}/download-url`);
}

export { API_BASE };

// --- Contracts ---

export interface ContractParty {
  id: string;
  customerId: string;
  role: string;
}
export interface ExternalContract {
  id: string;
  contractNo: string;
  gravePlotId: string;
  contractFileId: string | null;
  status: string;
  validTo: string | null;
  totalAmount: string | null;
  parties?: ContractParty[];
}

export const listContracts = (companyId: string): Promise<ExternalContract[]> =>
  apiFetch(`/api/v1/contracts?companyId=${encodeURIComponent(companyId)}`);
export const getContract = (id: string): Promise<ExternalContract> =>
  apiFetch(`/api/v1/contracts/${id}`);
export const createContract = (input: {
  companyId: string;
  contractNo: string;
  gravePlotId: string;
  contractFileId?: string;
  validTo?: string;
  totalAmount?: number;
}): Promise<ExternalContract> =>
  apiFetch('/api/v1/contracts', { method: 'POST', body: JSON.stringify(input) });
export const addContractParty = (
  id: string,
  customerId: string,
  role: string,
): Promise<ContractParty> =>
  apiFetch(`/api/v1/contracts/${id}/parties`, {
    method: 'POST',
    body: JSON.stringify({ customerId, role }),
  });
export const verifyContract = (id: string): Promise<ExternalContract> =>
  apiFetch(`/api/v1/contracts/${id}/verify`, { method: 'POST' });
/* Huỷ hợp đồng. Server đảo TOÀN BỘ hệ quả của `activate`: chấm dứt quyền sử dụng do hợp
 * đồng này sinh ra và nhả phần mộ về trống. Lý do bắt buộc — ba hệ quả cho một lần bấm. */
export const cancelContract = (id: string, reason: string): Promise<unknown> =>
  apiFetch(`/api/v1/contracts/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });

export const activateContract = (id: string): Promise<unknown> =>
  apiFetch(`/api/v1/contracts/${id}/activate`, { method: 'POST' });

// --- Services ---

export interface ServiceCatalog {
  id: string;
  code: string;
  name: string;
  price: string;
  durationMonths: number;
}
export interface ServiceSubscription {
  id: string;
  gravePlotId: string;
  serviceCatalogId: string;
  agreedPrice: string;
  effectiveFrom: string;
  effectiveTo: string;
  status: string;
}
export interface RevenueReport {
  totalCollected: string;
  transactions: number;
  byService: { serviceCatalogId: string; collected: string; count: number }[];
}

export const listServiceCatalog = (companyId: string): Promise<ServiceCatalog[]> =>
  apiFetch(`/api/v1/services/catalog?companyId=${encodeURIComponent(companyId)}`);
export const createServiceCatalog = (input: {
  companyId: string;
  code: string;
  name: string;
  price: number;
  durationMonths: number;
}): Promise<ServiceCatalog> =>
  apiFetch('/api/v1/services/catalog', { method: 'POST', body: JSON.stringify(input) });
export const listSubscriptions = (gravePlotId: string): Promise<ServiceSubscription[]> =>
  apiFetch(`/api/v1/services/subscriptions?gravePlotId=${encodeURIComponent(gravePlotId)}`);
export const subscribeService = (input: {
  companyId: string;
  gravePlotId: string;
  serviceCatalogId: string;
  customerId: string;
  effectiveFrom: string;
}): Promise<unknown> =>
  apiFetch('/api/v1/services/subscriptions', { method: 'POST', body: JSON.stringify(input) });
export const renewSubscription = (id: string): Promise<unknown> =>
  apiFetch(`/api/v1/services/subscriptions/${id}/renew`, { method: 'POST', body: '{}' });
export const serviceRevenue = (companyId: string): Promise<RevenueReport> =>
  apiFetch(`/api/v1/services/revenue?companyId=${encodeURIComponent(companyId)}`);

// --- Burials (M4) ---

export interface DeceasedPerson {
  id: string;
  personId: string;
  dateOfDeath: string | null;
  deathCertFileId: string | null;
}
export interface BurialRecord {
  id: string;
  gravePlotId: string;
  deceasedPersonId: string;
  contractId: string | null;
  burialDate: string | null;
  legalDocFileId: string | null;
  notes: string | null;
  status: string;
}

export const createDeceased = (input: {
  personId: string;
  dateOfDeath?: string;
  deathCertFileId?: string;
}): Promise<DeceasedPerson> =>
  apiFetch('/api/v1/burials/deceased', { method: 'POST', body: JSON.stringify(input) });
export const createBurial = (input: {
  gravePlotId: string;
  deceasedPersonId: string;
  /** Cốt số mấy trong phần mộ (1..sức chứa). Bỏ trống = chưa xác định vị trí. */
  slotNumber?: number;
  contractId?: string;
  burialDate?: string;
  legalDocFileId?: string;
  notes?: string;
}): Promise<BurialRecord> =>
  apiFetch('/api/v1/burials', { method: 'POST', body: JSON.stringify(input) });
export const listBurials = (gravePlotId: string): Promise<BurialRecord[]> =>
  apiFetch(`/api/v1/burials?gravePlotId=${encodeURIComponent(gravePlotId)}`);
export const verifyBurial = (id: string): Promise<BurialRecord> =>
  apiFetch(`/api/v1/burials/${id}/verify`, { method: 'POST' });
export const completeBurial = (id: string): Promise<BurialRecord> =>
  apiFetch(`/api/v1/burials/${id}/complete`, { method: 'POST' });

// --- Phân quyền: trục hub (ai phụ trách nghĩa trang nào) ---

export interface ScopeAssignment {
  id: string;
  cemeteryId: string;
  cemetery: { id: string; code: string; name: string; companyId: string } | null;
  validFrom: string;
  validTo: string | null;
  grantedBy: string | null;
}

export const listScopeAssignments = (userId: string): Promise<ScopeAssignment[]> =>
  apiFetch(`/api/v1/authz/scope-assignments?userId=${encodeURIComponent(userId)}`);

export const assignScope = (userId: string, cemeteryId: string): Promise<ScopeAssignment> =>
  apiFetch('/api/v1/authz/scope-assignments', {
    method: 'POST',
    body: JSON.stringify({ userId, cemeteryId }),
  });

export const revokeScope = (userId: string, cemeteryId: string): Promise<ScopeAssignment> =>
  apiFetch(
    `/api/v1/authz/scope-assignments/${encodeURIComponent(userId)}/${encodeURIComponent(cemeteryId)}`,
    { method: 'DELETE' },
  );

// --- Phân quyền: ma trận vai × quyền, và gán vai cho người ---

export interface RoleRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  grants: { code: string; scope: string; sensitivity: string }[];
}

export interface PermissionRow {
  code: string;
  description: string | null;
  sensitivity: string;
  wildcardExempt: boolean;
}

export interface RoleAssignmentRow {
  id: string;
  roleCode: string;
  roleName: string;
  companyId: string | null;
  scope: string | null;
  validFrom: string;
  validTo: string | null;
  grantedBy: string | null;
  grantReason: string | null;
}

export const listRoles = (): Promise<RoleRow[]> => apiFetch('/api/v1/authz/roles');

export const listPermissionCatalog = (): Promise<PermissionRow[]> =>
  apiFetch('/api/v1/authz/permissions');

export const grantPermission = (
  roleCode: string,
  permissionCode: string,
  scope: string,
): Promise<unknown> =>
  apiFetch('/api/v1/authz/role-permissions', {
    method: 'POST',
    body: JSON.stringify({ roleCode, permissionCode, scope }),
  });

export const revokePermission = (roleCode: string, permissionCode: string): Promise<unknown> =>
  apiFetch(
    `/api/v1/authz/role-permissions/${encodeURIComponent(roleCode)}/${encodeURIComponent(permissionCode)}`,
    { method: 'DELETE' },
  );

export const listRoleAssignments = (userId: string): Promise<RoleAssignmentRow[]> =>
  apiFetch(`/api/v1/authz/role-assignments?userId=${encodeURIComponent(userId)}`);

export const assignRole = (input: {
  userId: string;
  roleCode: string;
  companyId?: string;
  validTo?: string;
  reason: string;
}): Promise<unknown> =>
  apiFetch('/api/v1/authz/role-assignments', { method: 'POST', body: JSON.stringify(input) });

export const revokeRoleAssignment = (id: string): Promise<unknown> =>
  apiFetch(`/api/v1/authz/role-assignments/${encodeURIComponent(id)}`, { method: 'DELETE' });

// --- Phân quyền: chuỗi luật truy cập (mô hình tường lửa) ---

export interface AccessRuleRow {
  id: string;
  priority: number;
  effect: 'ALLOW' | 'DENY';
  permissionCode: string;
  subjectUserId: string | null;
  roleCode: string | null;
  reason: string;
  createdBy: string | null;
  validFrom: string;
  validTo: string | null;
  active: boolean;
}

export interface RuleExplanation {
  ruling: 'ALLOW' | 'DENY' | 'NO_MATCH';
  matchedRule: AccessRuleRow | null;
  fallsBackToRoleMatrix: boolean;
  scopeLevel: 'GROUP' | 'COMPANY' | 'SITE' | 'NONE';
}

export const listAccessRules = (): Promise<AccessRuleRow[]> =>
  apiFetch('/api/v1/authz/access-rules');

export const explainAccessRule = (userId: string, code: string): Promise<RuleExplanation> =>
  apiFetch(
    `/api/v1/authz/access-rules/explain?userId=${encodeURIComponent(userId)}&code=${encodeURIComponent(code)}`,
  );

export const createAccessRule = (input: {
  effect: 'ALLOW' | 'DENY';
  permissionCode: string;
  subjectUserId?: string;
  roleCode?: string;
  reason: string;
}): Promise<AccessRuleRow> =>
  apiFetch('/api/v1/authz/access-rules', { method: 'POST', body: JSON.stringify(input) });

export const moveAccessRule = (id: string, direction: 'up' | 'down'): Promise<unknown> =>
  apiFetch(`/api/v1/authz/access-rules/${encodeURIComponent(id)}/move-${direction}`, {
    method: 'POST',
  });

export const revokeAccessRule = (id: string): Promise<unknown> =>
  apiFetch(`/api/v1/authz/access-rules/${encodeURIComponent(id)}`, { method: 'DELETE' });

/* ---- Sơ đồ mặt bằng ---- */

export interface PlotMapEntry {
  id: string;
  plotCode: string;
  status: string;
  zone: string | null;
  subzone: string | null;
  block: string | null;
  row: string | null;
  mapX: number;
  mapY: number;
}

export interface PlotMap {
  cemeteryId: string;
  cemeteryName: string;
  plots: PlotMapEntry[];
  totalPlots: number;
  /** Số mộ chưa có toạ độ — server nói thẳng thay vì im lặng bỏ qua. */
  missingPosition: number;
}

export const getPlotMap = (cemeteryId: string): Promise<PlotMap> =>
  apiFetch(`/api/v1/cemetery/cemeteries/${encodeURIComponent(cemeteryId)}/plot-map`);

export const setPlotPosition = (
  gravePlotId: string,
  mapX: number | null,
  mapY: number | null,
): Promise<PlotMapEntry> =>
  apiFetch(`/api/v1/cemetery/grave-plots/${encodeURIComponent(gravePlotId)}/position`, {
    method: 'POST',
    body: JSON.stringify({ mapX, mapY }),
  });

/* ---- Thẻ quản lý mộ ---- */

export interface CardOccupant {
  burialRecordId: string;
  fullName: string;
  dateOfBirth: string | null;
  dateOfDeath: string | null;
  burialDate: string | null;
  relationshipToOwner: string | null;
  status: string;
}

export interface CardPlot {
  gravePlotId: string;
  plotCode: string;
  cemeteryName: string;
  zone: string | null;
  subzone: string | null;
  block: string | null;
  row: string | null;
  mapX: number | null;
  mapY: number | null;
  graveTypeName: string;
  capacity: number;
  emptySlots: number;
  occupants: CardOccupant[];
}

export interface GraveCard {
  customerId: string;
  customerCode: string;
  owner: {
    fullName: string | null;
    gender: string | null;
    dateOfBirth: string | null;
    nationalIdMasked: string | null;
    nationalIdIssuedOn: string | null;
    nationalIdIssuedPlace: string | null;
    phone: string | null;
    permanentAddress: string | null;
    religion: string | null;
  };
  ownershipDate: string | null;
  plots: CardPlot[];
  /** Chỉ có ở bản xem trước — số DỰ KIẾN nếu bấm cấp thẻ. */
  nextPrintNumber?: number;
  /** Chỉ có sau khi đã cấp. */
  printNumber?: number;
  cardPrintLogId?: string;
  approvedBy?: string | null;
  approvedTitle?: string | null;
  issued: boolean;
  reprint?: boolean;
}

export interface CardIssuance {
  id: string;
  printNumber: number;
  printReason: string | null;
  approvedBy: string | null;
  approvedTitle: string | null;
  issuedBy: string | null;
  issuedAt: string;
}

export const previewGraveCard = (customerId: string): Promise<GraveCard> =>
  apiFetch(`/api/v1/cemetery/cards/${encodeURIComponent(customerId)}/preview`);

export const issueGraveCard = (
  customerId: string,
  input: { printReason?: string; approvedBy?: string; approvedTitle?: string },
): Promise<GraveCard> =>
  apiFetch(`/api/v1/cemetery/cards/${encodeURIComponent(customerId)}/issue`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const reprintGraveCard = (cardPrintLogId: string): Promise<GraveCard> =>
  apiFetch(`/api/v1/cemetery/cards/reprint/${encodeURIComponent(cardPrintLogId)}`);

export const listCardIssuances = (customerId: string): Promise<CardIssuance[]> =>
  apiFetch(`/api/v1/cemetery/cards/${encodeURIComponent(customerId)}/issuances`);

/* ---- Hồ sơ nhân thân đầy đủ ---- */

export interface PersonSubRecord {
  id: string;
  status: string;
  isPrimary?: boolean;
  kind?: string | null;
  notes?: string | null;
}

export interface PersonProfile {
  id: string;
  fullName: string;
  gender: string | null;
  dateOfBirth: string | null;
  nationalIdMasked: string | null;
  nationalIdIssuedOn: string | null;
  nationalIdIssuedPlace: string | null;
  phone: string | null;
  email: string | null;
  permanentAddress: string | null;
  contactAddress: string | null;
  placeOfBirth: string | null;
  ethnicity: string | null;
  religion: string | null;
  /** Có bản ghi = đã mất. Suy từ hồ sơ người mất, không phải từ một cờ riêng. */
  deceased: { id: string; dateOfDeath: string | null; deathCertFileId: string | null } | null;
  phones: (PersonSubRecord & { phone: string })[];
  addresses: (PersonSubRecord & { address: string })[];
  education: (PersonSubRecord & {
    school: string | null;
    major: string | null;
    degree: string | null;
    graduationYear: number | null;
  })[];
  bankAccounts: (PersonSubRecord & {
    bankCode: string;
    accountNumber: string;
    accountHolder: string | null;
  })[];
}

export const getPersonProfile = (personId: string): Promise<PersonProfile> =>
  apiFetch(`/api/v1/crm/persons/${encodeURIComponent(personId)}/profile`);

export const addPersonPhone = (
  personId: string,
  input: { phone: string; kind?: string; isPrimary?: boolean; notes?: string },
) =>
  apiFetch(`/api/v1/crm/persons/${encodeURIComponent(personId)}/phones`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const addPersonAddress = (
  personId: string,
  input: { address: string; kind?: string; isPrimary?: boolean; notes?: string },
) =>
  apiFetch(`/api/v1/crm/persons/${encodeURIComponent(personId)}/addresses`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const addPersonEducation = (
  personId: string,
  input: { school?: string; major?: string; degree?: string; graduationYear?: number },
) =>
  apiFetch(`/api/v1/crm/persons/${encodeURIComponent(personId)}/education`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const addPersonBankAccount = (
  personId: string,
  input: {
    bankCode: string;
    accountNumber: string;
    accountHolder?: string;
    isPrimary?: boolean;
  },
) =>
  apiFetch(`/api/v1/crm/persons/${encodeURIComponent(personId)}/bank-accounts`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const deactivatePersonSubRecord = (
  personId: string,
  kind: 'phones' | 'addresses' | 'education' | 'bank-accounts',
  recordId: string,
) =>
  apiFetch(
    `/api/v1/crm/persons/${encodeURIComponent(personId)}/${kind}/${encodeURIComponent(recordId)}/deactivate`,
    { method: 'POST' },
  );

/* ---- Chi tiết khách hàng 360 ---- */

export interface CustomerPlot {
  /** Id của QUYỀN SỬ DỤNG — thu hồi và sang tên thao tác trên quyền, không trên mộ. */
  usageRightId: string;
  gravePlotId: string;
  plotCode: string | null;
  cemeteryName: string | null;
  zone: string | null;
  block: string | null;
  row: string | null;
  status: string | null;
  capacity: number | null;
  effectiveFrom: string | null;
}

export interface CustomerRelationship {
  id: string;
  relationshipType: string;
  status: string;
  /* Quy ước lưu trữ: khách hàng này LÀ `relationshipType` của `target`.
   * Cần giới tính + ngày sinh của target để đặt nhãn chiều ngược cho cụ thể. */
  target: {
    id: string;
    fullName: string;
    gender: string | null;
    dateOfBirth: string | null;
  };
}

/* Chấm dứt một quan hệ. Server đóng cả dòng đối ứng trong cùng giao dịch và ghi audit.
 * KHÔNG phải xoá: quan hệ đã từng đúng vẫn phải đọc lại được khi đối chiếu hồ sơ cũ. */
export const endRelationship = (relationshipId: string) =>
  apiFetch(`/api/v1/crm/relationships/${encodeURIComponent(relationshipId)}/end`, {
    method: 'POST',
  });

export interface CustomerDetail {
  id: string;
  customerCode: string;
  type: string;
  orgName: string | null;
  phone: string | null;
  email: string | null;
  companyId: string | null;
  personId: string | null;
  createdAt: string;
  person: PersonProfile | null;
  gravePlots: CustomerPlot[];
  relationships: CustomerRelationship[];
}

export const getCustomerDetail = (customerId: string): Promise<CustomerDetail> =>
  apiFetch(`/api/v1/crm/customers/${encodeURIComponent(customerId)}`);

/* ---- Nhật ký kiểm toán ---- */

export interface AuditEvent {
  id: string;
  occurredAt: string;
  actorType: string;
  actorId: string | null;
  actorLabel: string | null;
  action: string;
  entityType: string;
  entityId: string;
  entityTypeLabel: string;
  entityLabel: string;
  result: string;
  correlationId: string | null;
}

export interface AuditEventPage {
  data: AuditEvent[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AuditFacets {
  actors: { id: string; label: string; count: number }[];
  actions: { code: string; count: number }[];
  entityTypes: { code: string; label: string; count: number }[];
  results: { code: string; count: number }[];
}

export interface AuditFilters {
  from?: string;
  to?: string;
  actorId?: string;
  action?: string;
  entityType?: string;
  result?: string;
  page?: number;
  pageSize?: number;
}

export function listAuditEvents(filters: AuditFilters): Promise<AuditEventPage> {
  const qs = new URLSearchParams();
  /* Chỉ gửi tham số CÓ giá trị. Gửi `action=` rỗng thì DTO nhận chuỗi rỗng và lọc ra
   * không dòng nào — bộ lọc "tất cả" biến thành bộ lọc "không gì". */
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== '' && v !== null) {
      qs.set(k, String(v));
    }
  }
  return apiFetch<AuditEventPage>(`/api/v1/audit-events?${qs.toString()}`);
}

export const getAuditFacets = (): Promise<AuditFacets> => apiFetch('/api/v1/audit-events/facets');

export const createRelationship = (input: {
  sourcePersonId: string;
  targetPersonId: string;
  relationshipType: string;
  effectiveFrom?: string;
  verificationSource?: string;
}) => apiFetch('/api/v1/crm/relationships', { method: 'POST', body: JSON.stringify(input) });

export const listRelationshipTypes = (): Promise<
  { code: string; name: string; reciprocalCode: string }[]
> => apiFetch('/api/v1/cemetery/relationship-types');

/* ---- Quyền sử dụng phần mộ: ai đứng tên ---- */

export interface PlotOwnership {
  gravePlotId: string;
  plotCode: string;
  status: string;
  graveTypeName: string;
  capacity: number;
  holder: {
    customerId: string;
    customerCode: string;
    name: string | null;
    personId: string | null;
    isDeceased: boolean;
  } | null;
  occupants: {
    burialRecordId: string;
    slotNumber: number | null;
    personId: string;
    fullName: string;
    relationshipToOwner: string | null;
    status: string;
    burialDate: string | null;
  }[];
  /** Cốt còn trống, API tính sẵn để hai màn hình không đưa ra hai đáp án. */
  freeSlots: number[];
  unnumberedBurials: number;
}

export const getPlotOwnership = (gravePlotId: string): Promise<PlotOwnership> =>
  apiFetch(`/api/v1/cemetery/grave-plots/${encodeURIComponent(gravePlotId)}/ownership`);

export const assignUsageRight = (input: {
  gravePlotId: string;
  holderCustomerId: string;
  effectiveFrom?: string;
  note?: string;
}) => apiFetch('/api/v1/cemetery/usage-rights', { method: 'POST', body: JSON.stringify(input) });

/* ---- Sửa / xoá hồ sơ khách hàng ---- */

export interface UpdateCustomerInput {
  type?: string;
  orgName?: string;
  phone?: string;
  email?: string;
  /* Trường của nhân thân. KHÁC payload tạo mới ở một điểm: chuỗi rỗng ở đây nghĩa là
   * XOÁ giá trị cũ, không phải "bỏ qua". Không phân biệt được thì không có cách nào xoá
   * một giá trị đã nhập sai. */
  person?: {
    fullName?: string;
    gender?: string;
    dateOfBirth?: string;
    nationalId?: string;
    nationalIdIssuedOn?: string;
    nationalIdIssuedPlace?: string;
    phone?: string;
    email?: string;
    permanentAddress?: string;
    contactAddress?: string;
    placeOfBirth?: string;
    ethnicity?: string;
    religion?: string;
  };
}

export const updateCustomer = (customerId: string, input: UpdateCustomerInput) =>
  apiFetch(`/api/v1/crm/customers/${encodeURIComponent(customerId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });

export const deleteCustomer = (
  customerId: string,
): Promise<{ deleted: boolean; deletedRelationships: number }> =>
  apiFetch(`/api/v1/crm/customers/${encodeURIComponent(customerId)}`, { method: 'DELETE' });

/* ---- Thu hồi / sang tên quyền sử dụng phần mộ ---- */

export const releaseUsageRight = (usageRightId: string, reason: string) =>
  apiFetch(`/api/v1/cemetery/usage-rights/${encodeURIComponent(usageRightId)}/release`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });

export const transferUsageRight = (
  usageRightId: string,
  input: { toCustomerId: string; reason: string; effectiveFrom?: string },
) =>
  apiFetch(`/api/v1/cemetery/usage-rights/${encodeURIComponent(usageRightId)}/transfer`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export interface UsageRightHistoryEntry {
  usageRightId: string;
  holderCustomerId: string;
  holderName: string | null;
  holderCode: string | null;
  status: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  endedReason: string | null;
  previousRightId: string | null;
  /** Quyền sinh ra ngoài hợp đồng phải đọc ra được — nếu không, không ai phân biệt được
   *  quyền nào đã qua thẩm định. */
  viaContract: boolean;
}

export const getUsageRightHistory = (
  gravePlotId: string,
): Promise<{ gravePlotId: string; plotCode: string; history: UsageRightHistoryEntry[] }> =>
  apiFetch(`/api/v1/cemetery/grave-plots/${encodeURIComponent(gravePlotId)}/usage-right-history`);

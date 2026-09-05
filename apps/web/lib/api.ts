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
  /** Mã các phần mộ đang ĐỨNG TÊN. API gom sẵn để bảng không phải gọi thêm mỗi dòng. */
  gravePlotCodes: string[];
  /* NƠI AN NGHỈ — mộ khách này NẰM TRONG. Giữ RIÊNG khỏi `gravePlotCodes`, không gộp:
   * "đứng tên mộ" và "nằm trong mộ" là hai câu hỏi khác nhau, và một người có thể ở cả hai,
   * một trong hai, hay không cái nào. Gộp lại là cách hồ sơ an táng trở nên vô hình. */
  restingPlaces: { plotCode: string; slotNumber: number | null }[];
  /* Thẻ ĐANG mang. API `include` sẵn trong cùng truy vấn danh sách — không hỏi thêm lượt
   * nào cho mỗi dòng. Chỉ thẻ chưa gỡ; thẻ đã gỡ không hiện lại. */
  tags: { tagTypeId: string; tagType: { name: string; subject: string } }[];
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

/* Bộ lọc danh sách khách hàng. MỌI trục đều lọc ở SERVER.
 *
 * VÌ SAO KHÔNG LỌC Ở ĐÂY: truy vấn cắt ở `limit` dòng. Lọc sau khi nhận về là lọc trên
 * MỘT LÁT CẮT — "còn 3 người đã mất" có thể ra 0 chỉ vì 50 khách còn sống đứng trước họ,
 * và màn hình không có cách nào biết mình vừa hiện một câu trả lời sai.
 */
export type LifeStatus = 'all' | 'alive' | 'deceased';
export type GraveOwnerFilter = 'all' | 'yes' | 'no';

export interface CustomerFilters {
  q?: string;
  lifeStatus?: LifeStatus;
  graveOwner?: GraveOwnerFilter;
  cemeteryId?: string;
  companyId?: string;
  type?: string;
  status?: string;
  /** Đang mang thẻ nhãn này. MỘT thẻ mỗi lần ở đợt 1. */
  tagTypeId?: string;
  limit?: number;
}

/* Bao ngoài của danh sách. `total` đếm trên TOÀN BỘ tập đã lọc, `items` chỉ là lát cắt —
 * `truncated` nói thẳng rằng hai con số đó khác nhau, để màn hình không im lặng cho người
 * dùng đếm nhầm. */
export interface CustomerList {
  items: Customer360[];
  total: number;
  limit: number;
  truncated: boolean;
}

/* Giá trị mặc định KHÔNG được gửi lên. `all` nghĩa là "không lọc trục này", nên gửi nó chỉ
 * làm URL dài ra và làm `queryKey` của react-query khác nhau cho hai truy vấn giống hệt. */
function filterParams(f: CustomerFilters): string {
  const p = new URLSearchParams();
  if (f.q !== undefined && f.q !== '') p.set('q', f.q);
  if (f.lifeStatus !== undefined && f.lifeStatus !== 'all') p.set('lifeStatus', f.lifeStatus);
  if (f.graveOwner !== undefined && f.graveOwner !== 'all') p.set('graveOwner', f.graveOwner);
  if (f.cemeteryId !== undefined && f.cemeteryId !== '') p.set('cemeteryId', f.cemeteryId);
  if (f.companyId !== undefined && f.companyId !== '') p.set('companyId', f.companyId);
  if (f.type !== undefined && f.type !== '') p.set('type', f.type);
  if (f.status !== undefined && f.status !== '') p.set('status', f.status);
  if (f.tagTypeId !== undefined && f.tagTypeId !== '') p.set('tagTypeId', f.tagTypeId);
  if (f.limit !== undefined) p.set('limit', String(f.limit));
  return p.toString();
}

/** Danh sách khách hàng kèm bộ lọc — dùng cho MÀN HÌNH DANH SÁCH, nơi cần biết tổng số. */
export function listCustomers(filters: CustomerFilters): Promise<CustomerList> {
  return apiFetch<CustomerList>(`/api/v1/crm/customers/search?${filterParams(filters)}`);
}

/* Tìm nhanh cho các Ô CHỌN KHÁCH (hộp thoại an táng, hợp đồng, cấp thẻ…).
 *
 * Cùng MỘT endpoint với `listCustomers`, chỉ bóc lấy `items`. Cố ý không tách thành
 * endpoint thứ hai: hai endpoint cho cùng một câu hỏi là hai chỗ để luật lọc lệch nhau —
 * và luật ở đây gồm cả phép bó phạm vi, nên lệch nghĩa là một trong hai chỗ rò dữ liệu.
 */
export async function searchCustomers(
  q: string,
  filters: Omit<CustomerFilters, 'q'> = {},
): Promise<Customer360[]> {
  const res = await listCustomers({ ...filters, q });
  return res.items;
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

export const listGravePlots = (
  companyId: string,
  filters?: { status?: string; cemeteryId?: string; tagTypeId?: string },
): Promise<GravePlot[]> => {
  const p = new URLSearchParams({ companyId });
  if (filters?.status !== undefined && filters.status !== '') p.set('status', filters.status);
  if (filters?.cemeteryId !== undefined && filters.cemeteryId !== '')
    p.set('cemeteryId', filters.cemeteryId);
  if (filters?.tagTypeId !== undefined && filters.tagTypeId !== '')
    p.set('tagTypeId', filters.tagTypeId);
  return apiFetch(`/api/v1/cemetery/grave-plots?${p.toString()}`);
};
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
  userId: string;
  /** Chỉ có khi tra NGƯỢC theo vai — tra xuôi thì người dùng đã biết mình xem ai. */
  userEmail?: string | null;
  roleCode: string;
  roleName: string;
  companyId: string | null;
  scope: string | null;
  validFrom: string;
  validTo: string | null;
  grantedBy: string | null;
  grantReason: string | null;
}

/* LỆCH DANH MỤC QUYỀN giữa mã nguồn và CSDL đang chạy — chỉ SỐ ĐẾM.
 *
 * Đọc từ `/health`, KHÔNG qua `apiFetch`: `/health` nằm ngoài tiền tố `/api/v1` (xem
 * `setGlobalPrefix(..., { exclude: ['health'] })` ở `main.ts`) và là route `@Public`, không cần
 * token. Cố ý không mở một route mới cho việc này — `authz-invariants` neo danh sách route công
 * khai đúng bằng ba mục, và một mục thứ tư chỉ để hiện một cái banner là không đáng.
 *
 * Không có TÊN MÃ ở đây, và đó là chủ ý của phía máy chủ chứ không phải thiếu sót: `/health` ai
 * gõ được địa chỉ cũng đọc, nên nó không phát bản đồ bề mặt quyền. Muốn biết mã nào thì chạy
 * `pnpm --filter @erp/api check:permissions` — banner nói đúng câu đó.
 *
 * `null` nghĩa là CHƯA ĐO ĐƯỢC (API vừa lên, hoặc lần đối chiếu lúc boot hỏng), KHÔNG phải
 * "không lệch". Hai thứ đó không được hiển thị giống nhau. */
export interface AuthzCatalogHealth {
  checkedAt: string | null;
  missing: number | null;
  orphan: number | null;
  meta: number | null;
}

export const getAuthzCatalogHealth = async (): Promise<AuthzCatalogHealth> => {
  const res = await fetch(`${BASE}/health`);
  if (!res.ok) {
    throw new ApiError(res.status, 'Không đọc được trạng thái danh mục quyền từ /health');
  }
  const body = (await res.json()) as { authzCatalog?: AuthzCatalogHealth };
  return body.authzCatalog ?? { checkedAt: null, missing: null, orphan: null, meta: null };
};

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

/** Chiều NGƯỢC: vai này đang ở tay ai. Câu phải hỏi mỗi lần rà quyền. */
export const listRoleHolders = (roleCode: string): Promise<RoleAssignmentRow[]> =>
  apiFetch(`/api/v1/authz/role-assignments?roleCode=${encodeURIComponent(roleCode)}`);

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
  /* Giới tính để in nhãn quan hệ đúng vai ("Bố đẻ" chứ không "Cha/Mẹ") trên thẻ mộ. */
  gender: string | null;
  dateOfBirth: string | null;
  dateOfDeath: string | null;
  burialDate: string | null;
  relationshipToOwner: string | null;
  status: string;
}

export interface CardPlot {
  gravePlotId: string;
  plotCode: string;
  /* Thêm 05/09/2026: màn cấp thẻ lọc ô chọn người ký theo nghĩa trang của bộ mộ, mà trước đó
   * ở đây chỉ có TÊN — không lọc được bằng tên. */
  cemeteryId: string;
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
    /* Đầy đủ hay `079***789` là do API quyết theo quyền người đăng nhập — giao diện
     * không biết và không cần biết. Đừng thêm nhánh "nếu có quyền thì...": quyết định
     * đó nằm ở lớp che của API, một chỗ. */
    nationalId: string | null;
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
  /* Bảng kê tiền. `null` khi CHƯA TÍNH ĐƯỢC — khác hẳn với 0đ. `formatMoney` hiện `—` cho
   * null nhưng "0đ" cho 0, và "0đ" trên màn hình quầy đọc thành "miễn phí". */
  fee: CardFeeQuote | null;
  /* LÝ DO chưa tính được, do API nói ra và đã gọi TÊN công ty. `null` khi tính được bình
   * thường. Đừng tự chế câu thay nó ở màn hình: chỉ API mới biết vướng cái nào trong hai
   * nguyên nhân, và câu tự chế nêu cả hai là bắt người dùng tự chẩn đoán. */
  feeBlocked: string | null;
}

/* Tiền khai `string`, KHÔNG `number`: API trả Decimal ra chuỗi, và lớp che có thể thay nó
 * bằng '***' khi người xem không cầm `cemetery.card_fee.view`. Khai `number` là ép mọi chỗ
 * hiện tiền đi qua `Number('***')` = NaN. Luôn hiện qua `formatMoney`. */
export interface CardFeeLine {
  gravePlotId: string;
  plotCode: string;
  feeKind: 'FIRST_ISSUE' | 'REPRINT';
  feeScheduleId: string;
  unitPrice: string;
  remainsCount: number;
  feeAmount: string;
}

export interface CardFeeQuote {
  scheduleId: string;
  effectiveFrom: string;
  lines: CardFeeLine[];
  totalAmount: string;
  /** Chỉ có sau khi đã cấp. */
  waived?: boolean;
  waiveReason?: string | null;
}

export interface CardFeeSchedule {
  id: string;
  companyId: string;
  cardType: string;
  firstIssueFee: string;
  reprintFeePerRemains: string;
  effectiveFrom: string;
  decisionRef: string | null;
  createdBy: string | null;
  createdAt: string;
}

export const CARD_FEE_WAIVE_REASONS = [
  { value: 'COMPANY_FAULT', label: 'Lỗi thuộc về công ty' },
  { value: 'OLD_CARD_RETURNED', label: 'Khách nộp lại thẻ cũ' },
] as const;

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
  input: {
    printReason?: string;
    approvedBy?: string;
    approvedTitle?: string;
    waive?: boolean;
    waiveReason?: string;
  },
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
  /* AI ĐANG NẰM trong mộ này. Server trả kèm, KHÔNG để giao diện gọi `plotOwnership` cho
   * từng dòng: N lượt gọi và N ô nhấp nháy chờ tải, cho thứ vốn nằm sẵn cạnh dữ liệu đang
   * lấy. `gender` + `dateOfBirth` cần cho nhãn quan hệ ("anh trai" hay "em trai" phải so
   * tuổi với chủ mộ). */
  occupants: {
    burialRecordId: string;
    slotNumber: number | null;
    personId: string;
    fullName: string;
    gender: string | null;
    dateOfBirth: string | null;
    relationshipToOwner: string | null;
    /** Draft | Verified | Scheduled | Completed | Cancelled */
    status: string;
  }[];
}

/* NƠI AN NGHỈ — mộ khách hàng này NẰM TRONG.
 *
 * Cố ý TÁCH khỏi `CustomerPlot` (mộ khách hàng ĐỨNG TÊN) chứ không nhồi thêm cờ vào đó:
 * hai thứ trả lời hai câu hỏi khác nhau, và gộp chúng chính là cách hồ sơ an táng đang chặn
 * xoá khách hàng trở nên vô hình trên màn hình của họ (27/08/2026).
 */
export interface CustomerRestingPlace {
  burialRecordId: string;
  gravePlotId: string;
  plotCode: string | null;
  cemeteryName: string | null;
  slotNumber: number | null;
  /** Draft | Verified | Scheduled | Completed | Cancelled */
  status: string;
  burialDate: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  /* Chủ mộ và quan hệ là ẢNH CHỤP lúc đặt cốt — server trả đúng cái đã lưu, giao diện KHÔNG
   * được tính lại từ danh sách quan hệ hiện tại. Chủ mộ đổi vì kế thừa, quan hệ chấm dứt về
   * sau, nhưng hồ sơ vẫn phải kể đúng căn cứ hồi đó. */
  ownerCustomerId: string | null;
  ownerCustomerCode: string | null;
  ownerName: string | null;
  relationshipToOwner: string | null;
}

/* Huỷ hồ sơ an táng — NHẢ CỐT ra cho người khác, và gỡ rào chắn xoá khách hàng.
 * BẮT BUỘC có lý do: server từ chối chuỗi dưới 3 ký tự. */
export const cancelBurial = (burialRecordId: string, reason: string) =>
  apiFetch(`/api/v1/burials/${encodeURIComponent(burialRecordId)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });

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
  /* Gồm CẢ hồ sơ đã huỷ — đây là khối lịch sử, và hồ sơ đã huỷ chính là thứ giải thích vì
   * sao một cốt từng bị giữ rồi lại trống. Con số trên tab thì chỉ đếm phần CÒN HIỆU LỰC,
   * để nó khớp với con số trong lời từ chối xoá. */
  restingPlaces: CustomerRestingPlace[];
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
    dateOfBirth: string | null;
    isDeceased: boolean;
  } | null;
  occupants: {
    burialRecordId: string;
    slotNumber: number | null;
    personId: string;
    fullName: string;
    gender: string | null;
    dateOfBirth: string | null;
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

/* ---- Ai đủ điều kiện an táng vào một phần mộ ----
 *
 * Ba điều kiện do SERVER quyết: đã mất, có quan hệ đã xác nhận với chủ mộ (hoặc chính là
 * chủ mộ), và chưa nằm ở cốt nào. Giao diện không tự lọc — luật sống ở hai chỗ là luật sẽ
 * lệch, và người dùng sẽ thấy một danh sách khác với thứ server chấp nhận.
 */
export interface BurialCandidate {
  deceasedPersonId: string;
  personId: string;
  fullName: string;
  gender: string | null;
  dateOfBirth: string | null;
  dateOfDeath: string | null;
  customerId: string | null;
  customerCode: string | null;
  isOwner: boolean;
  relationshipType: string | null;
}

export interface BurialCandidates {
  /** Có giá trị = không ai đủ điều kiện VÌ LÝ DO này (chưa có chủ mộ, chủ là tổ chức…). */
  blocked: string | null;
  owner: {
    customerId: string;
    customerCode: string;
    personId: string;
    fullName: string;
    gender: string | null;
    /** Ngày sinh chủ mộ — cần để chọn "anh trai" hay "em trai" cho ứng viên. */
    dateOfBirth: string | null;
  } | null;
  candidates: BurialCandidate[];
}

export const getBurialCandidates = (gravePlotId: string): Promise<BurialCandidates> =>
  apiFetch(`/api/v1/burials/candidates?gravePlotId=${encodeURIComponent(gravePlotId)}`);

/* Biểu phí cấp thẻ — chỉ ĐỌC và THÊM. Không có hàm sửa hay xoá vì bảng append-only ở CSDL;
 * đổi giá là ban hành một dòng mới với ngày hiệu lực mới. */
export const listCardFeeSchedules = (companyId: string): Promise<CardFeeSchedule[]> =>
  apiFetch(`/api/v1/cemetery/card-fees?companyId=${encodeURIComponent(companyId)}`);

/* NGƯỜI KÝ THẺ MỘ — danh mục THEO NGHĨA TRANG (anh Bách chốt 05/09/2026: "người ký là người
 * quản lý nghĩa trang"). Đảo có ý thức quyết định 03/09, lúc đó là danh mục toàn hệ.
 *
 * Người của INDEVCO ký ở ô BÊN PHẢI tờ thẻ. Ô bên trái là chủ mộ và tên khách in thẳng từ
 * hồ sơ, không đi qua danh mục này.
 *
 * Lúc CẤP thẻ vẫn gửi `approvedBy`/`approvedTitle` dạng CHUỖI chứ không gửi id — tờ giấy
 * khách cầm ghi tên gì thì nhật ký phải đọc ra đúng tên đó, kể cả khi người ấy về sau đổi
 * chức danh hay nghỉ việc. Danh mục chỉ để chọn cho nhanh và khỏi gõ sai.
 */
export interface CardSigner {
  id: string;
  userId: string | null;
  cemeteryId: string | null;
  fullName: string;
  title: string;
  isDefault: boolean;
  status: string;
  createdAt: string;
  /* Tư cách được kiểm LẠI lúc đọc: một người thêm hợp lệ tháng trước có thể đã rời ghế quản
   * lý nghĩa trang hôm nay, và không lệnh UPDATE nào chạm vào dòng đó. Server trả cờ ra thay
   * vì lọc bỏ — người mất vai phải HIỆN RA kèm lý do, không lặng lẽ biến mất khỏi danh sách. */
  eligible: boolean;
  ineligibleReason: string | null;
}

export const listCardSigners = (cemeteryId?: string): Promise<CardSigner[]> =>
  apiFetch(
    `/api/v1/cemetery/card-signers${
      cemeteryId === undefined ? '' : `?cemeteryId=${encodeURIComponent(cemeteryId)}`
    }`,
  );

/* KHÔNG còn nhận họ tên và chức danh — anh Bách chốt 05/09/2026: "lấy trong danh sách nhân
 * viên". Server chép hai thứ đó từ hồ sơ tài khoản. */
export const createCardSigner = (input: {
  userId: string;
  cemeteryId: string;
  isDefault?: boolean;
}): Promise<CardSigner> =>
  apiFetch('/api/v1/cemetery/card-signers', { method: 'POST', body: JSON.stringify(input) });

export const updateCardSigner = (
  id: string,
  input: { status?: string; isDefault?: boolean },
): Promise<CardSigner> =>
  apiFetch(`/api/v1/cemetery/card-signers/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });

/* DANH BẠ NHÂN VIÊN — mở 05/09/2026. Dùng mã `iam.user.view` vốn đã có trong danh mục mà
 * chưa route nào tiêu thụ. Hai bộ lọc CẮT NHAU: `roleCode` trả người làm được việc đó ở đâu
 * đó, `cemeteryId` trả người phủ nơi này; chỉ ai thoả cả hai mới thực sự làm được ở đây. */
export interface DirectoryUser {
  id: string;
  email: string;
  fullName: string | null;
  title: string | null;
  status: string;
}

export const listUsers = (filters: {
  roleCode?: string;
  cemeteryId?: string;
}): Promise<DirectoryUser[]> => {
  const q = new URLSearchParams();
  if (filters.roleCode !== undefined) q.set('roleCode', filters.roleCode);
  if (filters.cemeteryId !== undefined) q.set('cemeteryId', filters.cemeteryId);
  const qs = q.toString();
  return apiFetch(`/api/v1/iam/users${qs === '' ? '' : `?${qs}`}`);
};

/* Công ty nào đã có biểu phí đang hiệu lực, công ty nào chưa — kèm số khách đang chờ.
 *
 * `effectiveFrom === null` nghĩa là CHƯA CÓ biểu phí hiệu lực hôm nay. Cẩn thận: nó không
 * đồng nghĩa "chưa ban hành dòng nào" — một biểu phí hẹn hiệu lực sang tháng sau cũng ra
 * `null` ở đây, và đúng như vậy, vì hôm nay vẫn chưa cấp thẻ được. */
export interface CardFeeCoverage {
  companyId: string;
  code: string;
  name: string;
  customerCount: number;
  effectiveFrom: string | null;
}

export const listCardFeeCoverage = (): Promise<CardFeeCoverage[]> =>
  apiFetch('/api/v1/cemetery/card-fees/coverage');

export const createCardFeeSchedule = (input: {
  companyId: string;
  firstIssueFee: number;
  reprintFeePerRemains: number;
  effectiveFrom: string;
  decisionRef?: string;
}): Promise<CardFeeSchedule> =>
  apiFetch('/api/v1/cemetery/card-fees', { method: 'POST', body: JSON.stringify(input) });

/* Số cốt — hai đường riêng vì hai mức hậu quả khác nhau: sửa một phần mộ chỉ đổi mộ đó,
 * sửa loại mộ đổi mọi phần mộ chưa có ghi đè. */
export const setGravePlotCapacity = (
  id: string,
  capacityOverride: number | null,
): Promise<GravePlot> =>
  apiFetch(`/api/v1/cemetery/grave-plots/${encodeURIComponent(id)}/capacity`, {
    method: 'POST',
    body: JSON.stringify({ capacityOverride }),
  });

export const setGraveTypeCapacity = (id: string, defaultCapacity: number): Promise<GraveType> =>
  apiFetch(`/api/v1/cemetery/grave-types/${encodeURIComponent(id)}/capacity`, {
    method: 'POST',
    body: JSON.stringify({ defaultCapacity }),
  });

/* ---------------------------------------------------------------------------
 * THẺ NHÃN — HAI danh mục TÁCH RIÊNG (thẻ mộ, thẻ khách), cả hai TOÀN HỆ.
 * Anh Bách chốt 03/09/2026.
 *
 * Hai bộ kiểu và hai bộ hàm, cố ý KHÔNG gộp bằng generic. Ranh giới giữa "thẻ dán lên vật"
 * và "thẻ dán lên người" là ranh giới CẤU TRÚC ở tầng dữ liệu (hai bảng, hai khoá ngoại);
 * gộp ở tầng này là mở lại đúng cái cửa mà tầng kia đang đóng.
 * ------------------------------------------------------------------------- */

interface TagTypeBase {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: 'Active' | 'Retired';
  createdAt: string;
  /** Số bản ghi ĐANG mang thẻ này — server đếm, giao diện không tự cộng. */
  usageCount: number;
}

/** Thẻ MỘ không có `subject`: nó nói về một VẬT, không có gì phải rào. */
export type PlotTagType = TagTypeBase;

/** Thẻ KHÁCH bắt buộc khai nói về HỒ SƠ hay GIAO DỊCH — đây là rào, không phải phân loại. */
export interface CustomerTagType extends TagTypeBase {
  subject: 'HO_SO' | 'GIAO_DICH';
}

export const CUSTOMER_TAG_SUBJECTS = [
  { value: 'HO_SO', label: 'Hồ sơ, giấy tờ', hint: 'Thiếu CCCD, thiếu giấy chứng tử…' },
  { value: 'GIAO_DICH', label: 'Giao dịch đã xảy ra', hint: 'Mua trước chưa an táng…' },
] as const;

export const CUSTOMER_TAG_SUBJECT_LABEL: Record<string, string> = {
  HO_SO: 'Hồ sơ',
  GIAO_DICH: 'Giao dịch',
};

export interface AssignedPlotTag {
  id: string;
  tagTypeId: string;
  assignedBy: string | null;
  assignedAt: string;
  tagType: PlotTagType;
}

export interface AssignedCustomerTag {
  id: string;
  tagTypeId: string;
  assignedBy: string | null;
  assignedAt: string;
  tagType: CustomerTagType;
}

const TAGS = '/api/v1/cemetery/tags';

/* Không có hàm XOÁ ở đâu: danh mục chỉ NGỪNG DÙNG, thẻ đã gắn chỉ GỠ (lưu vết). */
export const listPlotTagTypes = (): Promise<PlotTagType[]> => apiFetch(`${TAGS}/plot-types`);

export const createPlotTagType = (input: {
  code: string;
  name: string;
  description?: string;
}): Promise<PlotTagType> =>
  apiFetch(`${TAGS}/plot-types`, { method: 'POST', body: JSON.stringify(input) });

export const updatePlotTagType = (
  id: string,
  input: { name?: string; description?: string; status?: 'Active' | 'Retired' },
): Promise<PlotTagType> =>
  apiFetch(`${TAGS}/plot-types/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });

export const listCustomerTagTypes = (): Promise<CustomerTagType[]> =>
  apiFetch(`${TAGS}/customer-types`);

export const createCustomerTagType = (input: {
  code: string;
  name: string;
  subject: string;
  description?: string;
}): Promise<CustomerTagType> =>
  apiFetch(`${TAGS}/customer-types`, { method: 'POST', body: JSON.stringify(input) });

export const updateCustomerTagType = (
  id: string,
  input: { name?: string; description?: string; status?: 'Active' | 'Retired' },
): Promise<CustomerTagType> =>
  apiFetch(`${TAGS}/customer-types/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });

export const listPlotTags = (gravePlotId: string): Promise<AssignedPlotTag[]> =>
  apiFetch(`${TAGS}/plots/${encodeURIComponent(gravePlotId)}`);

export const assignPlotTag = (gravePlotId: string, tagTypeId: string): Promise<AssignedPlotTag> =>
  apiFetch(`${TAGS}/plots/${encodeURIComponent(gravePlotId)}`, {
    method: 'POST',
    body: JSON.stringify({ tagTypeId }),
  });

/* Gỡ đi qua POST `/remove`, không qua DELETE — đây không phải xoá một tài nguyên mà là ghi
 * thêm một sự kiện "đã gỡ, bởi ai, vì sao", và nó mang được `body` chứa lý do. */
export const removePlotTag = (
  gravePlotId: string,
  tagTypeId: string,
  reason?: string,
): Promise<AssignedPlotTag> =>
  apiFetch(
    `${TAGS}/plots/${encodeURIComponent(gravePlotId)}/${encodeURIComponent(tagTypeId)}/remove`,
    { method: 'POST', body: JSON.stringify(reason === undefined ? {} : { reason }) },
  );

export const listCustomerTags = (customerId: string): Promise<AssignedCustomerTag[]> =>
  apiFetch(`${TAGS}/customers/${encodeURIComponent(customerId)}`);

export const assignCustomerTag = (
  customerId: string,
  tagTypeId: string,
): Promise<AssignedCustomerTag> =>
  apiFetch(`${TAGS}/customers/${encodeURIComponent(customerId)}`, {
    method: 'POST',
    body: JSON.stringify({ tagTypeId }),
  });

export const removeCustomerTag = (
  customerId: string,
  tagTypeId: string,
  reason?: string,
): Promise<AssignedCustomerTag> =>
  apiFetch(
    `${TAGS}/customers/${encodeURIComponent(customerId)}/${encodeURIComponent(tagTypeId)}/remove`,
    { method: 'POST', body: JSON.stringify(reason === undefined ? {} : { reason }) },
  );

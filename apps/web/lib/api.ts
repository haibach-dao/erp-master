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

export interface AuthUser {
  id: string;
  email: string;
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
}

export interface Customer360 {
  id: string;
  customerCode: string;
  type: string;
  orgName: string | null;
  phone: string | null;
  email: string | null;
  person: CustomerPerson | null;
}

export interface DedupWarning {
  reason: string;
  matches: unknown[];
}

export interface CreateCustomerInput {
  type: string;
  person?: { fullName: string; gender?: string; nationalId?: string };
  orgName?: string;
  phone?: string;
  email?: string;
}

export function searchCustomers(q: string): Promise<Customer360[]> {
  return apiFetch<Customer360[]>(`/api/v1/crm/customers/search?q=${encodeURIComponent(q)}`);
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

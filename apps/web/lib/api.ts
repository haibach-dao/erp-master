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

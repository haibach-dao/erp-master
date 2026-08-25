'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listCompanies } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { canSeeCompany } from '@/lib/permissions';
import { Alert } from '@/components/ui/alert';
import { Field } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

/* Company chooser, limited to the companies the caller is actually bound to.
 *
 * The list used to be every company in the system, and the chosen id was passed straight
 * to the API as a query parameter — which meant the caller picked their own scope. The
 * server does not yet reject an out-of-scope companyId (that is the next step), so this
 * narrowing is presentation only for now. It is still worth doing first: it stops the UI
 * teaching people a habit the server is about to refuse.
 */
export function CompanyPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const { user } = useAuth();
  const companies = useQuery({ queryKey: ['companies'], queryFn: listCompanies });
  const visible = (companies.data ?? []).filter((c) => canSeeCompany(user, c.id));
  const only = visible.length === 1 ? visible[0] : undefined;

  // One company and nothing to choose between: select it instead of showing an empty
  // picker that makes every page look broken until the user touches it.
  useEffect(() => {
    if (value === '' && only !== undefined) {
      onChange(only.id);
    }
  }, [value, only, onChange]);

  if (companies.isSuccess && visible.length === 0) {
    return (
      <Alert variant="warning" title="Chưa được gán công ty nào">
        Liên hệ quản trị để được cấp phạm vi.
      </Alert>
    );
  }

  return (
    <Field label="Công ty" htmlFor="company-picker" className="w-full max-w-xs">
      <Select
        id="company-picker"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={companies.isPending}
      >
        <option value="">— chọn công ty —</option>
        {visible.map((c) => (
          <option key={c.id} value={c.id}>
            {c.code} · {c.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

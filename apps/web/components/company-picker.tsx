'use client';

import { useQuery } from '@tanstack/react-query';
import { listCompanies } from '@/lib/api';

export function CompanyPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const companies = useQuery({ queryKey: ['companies'], queryFn: listCompanies });
  return (
    <label className="text-sm">
      Công ty{' '}
      <select
        className="rounded-md border border-border bg-background px-3 py-2 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">— chọn công ty —</option>
        {companies.data?.map((c) => (
          <option key={c.id} value={c.id}>
            {c.code} · {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}

'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createCustomer, searchCustomers, type DedupWarning } from '@/lib/api';
import { Button } from '@/components/ui/button';

const inputClass = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm';

export default function CustomersPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [warnings, setWarnings] = useState<DedupWarning[]>([]);
  const [form, setForm] = useState({
    type: 'INDIVIDUAL',
    fullName: '',
    nationalId: '',
    orgName: '',
    phone: '',
    email: '',
  });

  const list = useQuery({
    queryKey: ['customers', q],
    queryFn: () => searchCustomers(q),
  });

  const create = useMutation({
    mutationFn: () =>
      createCustomer({
        type: form.type,
        ...(form.type === 'INDIVIDUAL'
          ? {
              person: {
                fullName: form.fullName,
                ...(form.nationalId !== '' ? { nationalId: form.nationalId } : {}),
              },
            }
          : { orgName: form.orgName }),
        ...(form.phone !== '' ? { phone: form.phone } : {}),
        ...(form.email !== '' ? { email: form.email } : {}),
      }),
    onSuccess: (res) => {
      setWarnings(res.warnings);
      setForm({
        type: 'INDIVIDUAL',
        fullName: '',
        nationalId: '',
        orgName: '',
        phone: '',
        email: '',
      });
      void qc.invalidateQueries({ queryKey: ['customers'] });
    },
  });

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Khách hàng</h1>
        <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
          {open ? 'Đóng' : 'Thêm khách hàng'}
        </Button>
      </div>

      {open && (
        <form
          className="grid max-w-2xl grid-cols-2 gap-3 rounded-md border border-border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <label className="text-sm">
            Loại
            <select
              className={inputClass}
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
            >
              <option value="INDIVIDUAL">Cá nhân</option>
              <option value="ORGANIZATION">Tổ chức</option>
              <option value="AGENT">Đại lý</option>
              <option value="PROSPECT">Tiềm năng</option>
            </select>
          </label>
          {form.type === 'INDIVIDUAL' ? (
            <>
              <label className="text-sm">
                Họ tên
                <input
                  className={inputClass}
                  value={form.fullName}
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                  required
                />
              </label>
              <label className="text-sm">
                CCCD (tùy chọn)
                <input
                  className={inputClass}
                  value={form.nationalId}
                  onChange={(e) => setForm({ ...form, nationalId: e.target.value })}
                />
              </label>
            </>
          ) : (
            <label className="text-sm">
              Tên tổ chức
              <input
                className={inputClass}
                value={form.orgName}
                onChange={(e) => setForm({ ...form, orgName: e.target.value })}
                required
              />
            </label>
          )}
          <label className="text-sm">
            Điện thoại
            <input
              className={inputClass}
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </label>
          <label className="text-sm">
            Email
            <input
              className={inputClass}
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
          <div className="col-span-2 flex items-center gap-3">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Đang lưu…' : 'Lưu'}
            </Button>
            {create.error !== null && (
              <span className="text-sm text-red-600">{(create.error as Error).message}</span>
            )}
          </div>
        </form>
      )}

      {warnings.length > 0 && (
        <div className="max-w-2xl rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">Cảnh báo trùng (không tự gộp):</p>
          <ul className="list-disc pl-5">
            {warnings.map((w) => (
              <li key={w.reason}>
                {w.reason} — {w.matches.length} bản ghi giống
              </li>
            ))}
          </ul>
        </div>
      )}

      <input
        className={`${inputClass} max-w-md`}
        placeholder="Tìm theo tên, mã KH, điện thoại, email…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="p-2 text-left font-medium">Mã KH</th>
              <th className="p-2 text-left font-medium">Loại</th>
              <th className="p-2 text-left font-medium">Tên</th>
              <th className="p-2 text-left font-medium">CCCD</th>
              <th className="p-2 text-left font-medium">Điện thoại</th>
              <th className="p-2 text-left font-medium">Email</th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading && (
              <tr>
                <td className="p-3 text-muted-foreground" colSpan={6}>
                  Đang tải…
                </td>
              </tr>
            )}
            {list.data?.length === 0 && (
              <tr>
                <td className="p-3 text-muted-foreground" colSpan={6}>
                  Không có khách hàng.
                </td>
              </tr>
            )}
            {list.data?.map((c) => (
              <tr key={c.id} className="border-t border-border">
                <td className="p-2 font-mono text-xs">{c.customerCode}</td>
                <td className="p-2">{c.type}</td>
                <td className="p-2">{c.person?.fullName ?? c.orgName ?? '—'}</td>
                <td className="p-2">{c.person?.nationalIdMasked ?? '—'}</td>
                <td className="p-2">{c.phone ?? '—'}</td>
                <td className="p-2">{c.email ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Banknote,
  GraduationCap,
  IdCard,
  MapPin,
  Phone,
  Plus,
  Users,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addPersonAddress,
  addPersonBankAccount,
  addPersonEducation,
  addPersonPhone,
  createRelationship,
  deactivatePersonSubRecord,
  getCustomerDetail,
  listRelationshipTypes,
  searchCustomers,
  type CustomerDetail,
} from '@/lib/api';
import { customerType } from '@/lib/status';
import { cn } from '@/lib/utils';
import { CustomerGraveActions } from '@/components/customer-grave-actions';
import { PageHeader } from '@/components/ui/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableMessage,
  TableRow,
} from '@/components/ui/table';

/* Giá trị bị lớp che thay bằng `***` phải TRÔNG khác giá trị thật, nếu không người dùng
 * tưởng dữ liệu sai chứ không nghĩ là mình thiếu quyền. */
function Masked({ value }: { value: string | null }) {
  if (value === null || value === '') return <span className="text-muted-foreground">—</span>;
  if (value === '***') {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <span className="font-mono">•••</span>
        <Badge variant="outline">cần quyền</Badge>
      </span>
    );
  }
  return <span>{value}</span>;
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex gap-3 py-1.5 text-sm">
      <span className="w-40 shrink-0 text-muted-foreground">{label}</span>
      <Masked value={value} />
    </div>
  );
}

function fmtDate(v: string | null): string | null {
  if (v === null || v === '') return null;
  // Ngày bị che thành NĂM trả về chuỗi 4 chữ số — đừng ép nó qua Date rồi ra "Invalid".
  if (/^\d{4}$/.test(v)) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('vi-VN');
}

const GENDER: Record<string, string> = { MALE: 'Nam', FEMALE: 'Nữ', UNKNOWN: 'Không xác định' };
const RELATIONSHIP: Record<string, string> = {
  SPOUSE: 'Vợ/Chồng',
  PARENT: 'Cha/Mẹ',
  CHILD: 'Con',
  SIBLING: 'Anh/Chị/Em',
};

type SubKind = 'phones' | 'addresses' | 'education' | 'bank-accounts';

const EMPTY_SUB = {
  phone: '',
  address: '',
  kind: '',
  school: '',
  major: '',
  degree: '',
  graduationYear: '',
  bankCode: '',
  accountNumber: '',
  accountHolder: '',
  isPrimary: false,
};

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [adding, setAdding] = useState<SubKind | null>(null);
  const [relOpen, setRelOpen] = useState(false);
  const [rel, setRel] = useState({ targetPersonId: '', relationshipType: '', q: '' });
  const [sub, setSub] = useState(EMPTY_SUB);

  const detail = useQuery({
    queryKey: ['customerDetail', id],
    queryFn: () => getCustomerDetail(id),
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: ['customerDetail', id] });

  const relTypes = useQuery({ queryKey: ['relationshipTypes'], queryFn: listRelationshipTypes });
  /* Chọn người có quan hệ từ danh sách KHÁCH HÀNG. Người mất cũng là khách hàng, nên
   * không cần một đường tra cứu nhân thân riêng — và một đường riêng là chỗ dữ liệu lại
   * lệch ra ngoài danh sách khách như trước. */
  const relCustomers = useQuery({
    queryKey: ['customers', rel.q],
    queryFn: () => searchCustomers(rel.q),
    enabled: relOpen,
  });

  /* Quan hệ khai từ CHỦ MỘ tới người kia: `relationshipType` là "người kia LÀ GÌ của chủ
   * mộ". Server tự tạo dòng đối ứng chiều ngược trong cùng giao dịch, nên ở đây chỉ khai
   * một chiều. */
  const addRel = useMutation({
    mutationFn: () => {
      const personId = detail.data?.personId;
      if (personId === null || personId === undefined) {
        throw new Error('Khách hàng tổ chức không có hồ sơ nhân thân');
      }
      return createRelationship({
        sourcePersonId: personId,
        targetPersonId: rel.targetPersonId,
        relationshipType: rel.relationshipType,
      });
    },
    onSuccess: () => {
      setRel({ targetPersonId: '', relationshipType: '', q: '' });
      setRelOpen(false);
      refresh();
    },
  });

  const addSub = useMutation({
    mutationFn: async () => {
      const personId = detail.data?.personId;
      if (personId === null || personId === undefined) {
        throw new Error('Khách hàng tổ chức chưa gắn hồ sơ nhân thân');
      }
      if (adding === 'phones') {
        return addPersonPhone(personId, {
          phone: sub.phone,
          ...(sub.kind !== '' ? { kind: sub.kind } : {}),
          isPrimary: sub.isPrimary,
        });
      }
      if (adding === 'addresses') {
        return addPersonAddress(personId, {
          address: sub.address,
          ...(sub.kind !== '' ? { kind: sub.kind } : {}),
          isPrimary: sub.isPrimary,
        });
      }
      if (adding === 'education') {
        return addPersonEducation(personId, {
          ...(sub.school !== '' ? { school: sub.school } : {}),
          ...(sub.major !== '' ? { major: sub.major } : {}),
          ...(sub.degree !== '' ? { degree: sub.degree } : {}),
          ...(sub.graduationYear !== '' ? { graduationYear: Number(sub.graduationYear) } : {}),
        });
      }
      return addPersonBankAccount(personId, {
        bankCode: sub.bankCode,
        accountNumber: sub.accountNumber,
        ...(sub.accountHolder !== '' ? { accountHolder: sub.accountHolder } : {}),
        isPrimary: sub.isPrimary,
      });
    },
    onSuccess: () => {
      setSub(EMPTY_SUB);
      setAdding(null);
      refresh();
    },
  });

  const deactivate = useMutation({
    mutationFn: ({ kind, recordId }: { kind: SubKind; recordId: string }) => {
      const personId = detail.data?.personId;
      if (personId === null || personId === undefined) {
        throw new Error('Không có hồ sơ nhân thân');
      }
      return deactivatePersonSubRecord(personId, kind, recordId);
    },
    onSuccess: refresh,
  });

  if (detail.isPending) {
    return <p className="text-sm text-muted-foreground">Đang tải hồ sơ…</p>;
  }
  if (detail.error !== null) {
    return <Alert variant="destructive">{(detail.error as Error).message}</Alert>;
  }

  const c: CustomerDetail = detail.data;
  const p = c.person;
  const name = p?.fullName ?? c.orgName ?? c.customerCode;

  return (
    <section className="space-y-6">
      {/* Sống hay đã mất là thứ quyết định người này còn đứng tên mộ được không, nên nó
          phải nằm ở chỗ nhìn đầu tiên chứ không lẫn trong bảng thuộc tính. */}
      {p !== null && p.deceased !== null ? (
        <Alert variant="warning" title="Khách hàng đã mất">
          {p.deceased.dateOfDeath === null
            ? 'Chưa ghi ngày mất.'
            : `Ngày mất: ${fmtDate(p.deceased.dateOfDeath) ?? '—'}.`}{' '}
          Không gán thêm phần mộ cho người đã mất — chuyển quyền phải qua thủ tục kế thừa.
        </Alert>
      ) : null}

      <PageHeader
        title={name}
        description={`${customerType(c.type)} · ${c.customerCode}${p === null ? '' : p.deceased === null ? ' · Còn sống' : ' · Đã mất'}`}
        actions={
          /* `Link` mang class của nút, KHÔNG bọc `Link` trong `Button`: `<a>` lồng trong
           * `<button>` là HTML không hợp lệ và trình duyệt tự gỡ ra, làm hỏng điều hướng. */
          <Link
            href="/cemetery/customers"
            className={cn(buttonVariants({ variant: 'secondary' }), 'gap-1.5')}
          >
            <ArrowLeft className="size-4" aria-hidden />
            Về danh sách
          </Link>
        }
      />

      {addSub.error !== null ? (
        <Alert variant="destructive">{(addSub.error as Error).message}</Alert>
      ) : null}
      {deactivate.error !== null ? (
        <Alert variant="destructive">{(deactivate.error as Error).message}</Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <IdCard className="size-4" aria-hidden />
              Thông tin nhân thân
            </CardTitle>
          </CardHeader>
          <CardContent>
            {p === null ? (
              <EmptyState
                icon={Users}
                title="Khách hàng tổ chức"
                description="Không có hồ sơ nhân thân gắn kèm."
              />
            ) : (
              <div className="divide-y divide-border">
                <Row label="Họ và tên" value={p.fullName} />
                <Row
                  label="Giới tính"
                  value={p.gender === null ? null : (GENDER[p.gender] ?? p.gender)}
                />
                <Row label="Ngày sinh" value={fmtDate(p.dateOfBirth)} />
                <Row label="Số CCCD" value={p.nationalIdMasked} />
                <Row label="Ngày cấp" value={fmtDate(p.nationalIdIssuedOn)} />
                <Row label="Nơi cấp" value={p.nationalIdIssuedPlace} />
                <Row label="Điện thoại chính" value={p.phone} />
                <Row label="Email chính" value={p.email} />
                <Row label="Địa chỉ thường trú" value={p.permanentAddress} />
                <Row label="Địa chỉ liên hệ" value={p.contactAddress} />
                <Row label="Dân tộc" value={p.ethnicity} />
                <Row label="Tôn giáo" value={p.religion} />
                <Row label="Nơi sinh" value={p.placeOfBirth} />
              </div>
            )}
          </CardContent>
        </Card>

        <CustomerGraveActions customer={c} onChanged={refresh} />
      </div>

      {p !== null ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <SubCard
            icon={Phone}
            title="Số điện thoại khác"
            hint="Số chính nằm ở khối nhân thân bên trên."
            onAdd={() => setAdding('phones')}
            empty={p.phones.length === 0}
            emptyText="Chưa có số nào khác."
          >
            {p.phones.map((row) => (
              <SubRow
                key={row.id}
                primary={row.isPrimary === true}
                main={row.phone}
                meta={row.kind ?? null}
                onRemove={() => deactivate.mutate({ kind: 'phones', recordId: row.id })}
              />
            ))}
          </SubCard>

          <SubCard
            icon={MapPin}
            title="Địa chỉ khác"
            hint="Thường trú và liên hệ nằm ở khối nhân thân."
            onAdd={() => setAdding('addresses')}
            empty={p.addresses.length === 0}
            emptyText="Chưa có địa chỉ nào khác."
          >
            {p.addresses.map((row) => (
              <SubRow
                key={row.id}
                primary={row.isPrimary === true}
                main={row.address}
                meta={row.kind ?? null}
                onRemove={() => deactivate.mutate({ kind: 'addresses', recordId: row.id })}
              />
            ))}
          </SubCard>

          <SubCard
            icon={GraduationCap}
            title="Học vấn"
            onAdd={() => setAdding('education')}
            empty={p.education.length === 0}
            emptyText="Chưa ghi nhận học vấn."
          >
            {p.education.map((row) => (
              <SubRow
                key={row.id}
                primary={false}
                main={[row.degree, row.major].filter(Boolean).join(' — ') || '(chưa rõ)'}
                meta={[row.school, row.graduationYear].filter(Boolean).join(' · ') || null}
                onRemove={() => deactivate.mutate({ kind: 'education', recordId: row.id })}
              />
            ))}
          </SubCard>

          <SubCard
            icon={Banknote}
            title="Tài khoản ngân hàng"
            hint="Số tài khoản mở bằng quyền riêng crm.person.view_financial."
            onAdd={() => setAdding('bank-accounts')}
            empty={p.bankAccounts.length === 0}
            emptyText="Chưa có tài khoản nào."
          >
            {p.bankAccounts.map((row) => (
              <SubRow
                key={row.id}
                primary={row.isPrimary === true}
                main={row.accountNumber}
                meta={[row.bankCode, row.accountHolder].filter(Boolean).join(' · ') || null}
                masked
                onRemove={() => deactivate.mutate({ kind: 'bank-accounts', recordId: row.id })}
              />
            ))}
          </SubCard>
        </div>
      ) : null}

      <Card>
        <CardHeader className="flex-row items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Users className="size-4" aria-hidden />
              Quan hệ nhân thân
            </CardTitle>
            {/* Nói rõ vì sao khối này quan trọng: không có quan hệ thì không đặt cốt được. */}
            <p className="text-xs text-muted-foreground">
              An táng vào mộ của khách này đòi người mất có quan hệ đã xác nhận với họ.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={p === null}
            onClick={() => setRelOpen(true)}
            title={p === null ? 'Khách hàng tổ chức không có hồ sơ nhân thân' : undefined}
          >
            <Plus className="size-4" aria-hidden />
            Khai quan hệ
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Người liên quan</TableHead>
                <TableHead>Quan hệ</TableHead>
                <TableHead>Trạng thái</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {c.relationships.length === 0 ? (
                <TableMessage colSpan={3}>
                  <EmptyState
                    icon={Users}
                    title="Chưa khai quan hệ nào"
                    description="An táng đòi có quan hệ đã xác nhận với chủ mộ."
                  />
                </TableMessage>
              ) : (
                c.relationships.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.target.fullName}</TableCell>
                    <TableCell>{RELATIONSHIP[r.relationshipType] ?? r.relationshipType}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === 'Confirmed' ? 'success' : 'warning'}>
                        {r.status === 'Confirmed' ? 'Đã xác nhận' : r.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog
        open={relOpen}
        onClose={() => setRelOpen(false)}
        title="Khai quan hệ nhân thân"
        description="Quan hệ khai từ khách hàng này tới người kia. Hệ tự tạo chiều ngược."
        footer={
          <>
            <Button variant="secondary" onClick={() => setRelOpen(false)}>
              Huỷ
            </Button>
            <Button
              disabled={
                rel.targetPersonId === '' || rel.relationshipType === '' || addRel.isPending
              }
              loading={addRel.isPending}
              onClick={() => addRel.mutate()}
            >
              Lưu quan hệ
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {addRel.error !== null ? (
            <Alert variant="destructive">{(addRel.error as Error).message}</Alert>
          ) : null}

          <Field label="Tìm người" hint="Gõ tên để tìm trong hồ sơ nhân thân.">
            <Input
              value={rel.q}
              onChange={(e) => setRel({ ...rel, q: e.target.value })}
              placeholder="Họ tên…"
            />
          </Field>

          <Field label="Người có quan hệ">
            <Select
              value={rel.targetPersonId}
              onChange={(e) => setRel({ ...rel, targetPersonId: e.target.value })}
            >
              <option value="">— Chọn người —</option>
              {(relCustomers.data ?? [])
                /* Bỏ khách tổ chức (không có nhân thân) và bỏ chính chủ mộ: server chặn
                   quan hệ với chính mình, nên đừng mời người dùng chọn một lựa chọn chắc
                   chắn lỗi. */
                .filter((x) => x.person !== null && x.person.id !== c.personId)
                .map((x) => (
                  <option key={x.id} value={x.person?.id ?? x.id}>
                    {x.person?.fullName} · {x.customerCode}
                    {x.isDeceased ? ' (đã mất)' : ''}
                  </option>
                ))}
            </Select>
          </Field>

          <Field
            label="Là gì của khách hàng này"
            hint={`Ví dụ: chọn "Con" nghĩa là người kia là con của ${name}.`}
          >
            <Select
              value={rel.relationshipType}
              onChange={(e) => setRel({ ...rel, relationshipType: e.target.value })}
            >
              <option value="">— Chọn quan hệ —</option>
              {(relTypes.data ?? []).map((t) => (
                <option key={t.code} value={t.code}>
                  {RELATIONSHIP[t.code] ?? t.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={adding !== null}
        onClose={() => setAdding(null)}
        title={
          adding === 'phones'
            ? 'Thêm số điện thoại'
            : adding === 'addresses'
              ? 'Thêm địa chỉ'
              : adding === 'education'
                ? 'Thêm học vấn'
                : 'Thêm tài khoản ngân hàng'
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setAdding(null)}>
              Huỷ
            </Button>
            <Button form="sub-form" type="submit" loading={addSub.isPending}>
              Lưu
            </Button>
          </>
        }
      >
        <form
          id="sub-form"
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            addSub.mutate();
          }}
        >
          {adding === 'phones' ? (
            <>
              <Field label="Số điện thoại" required>
                <Input
                  value={sub.phone}
                  onChange={(e) => setSub({ ...sub, phone: e.target.value })}
                  required
                />
              </Field>
              <Field label="Loại">
                <Select value={sub.kind} onChange={(e) => setSub({ ...sub, kind: e.target.value })}>
                  <option value="">— Không ghi —</option>
                  <option value="MOBILE">Di động</option>
                  <option value="HOME">Nhà riêng</option>
                  <option value="WORK">Cơ quan</option>
                  <option value="RELATIVE">Người thân</option>
                </Select>
              </Field>
            </>
          ) : null}

          {adding === 'addresses' ? (
            <>
              <Field label="Địa chỉ" required className="sm:col-span-2">
                <Input
                  value={sub.address}
                  onChange={(e) => setSub({ ...sub, address: e.target.value })}
                  required
                />
              </Field>
              <Field label="Loại">
                <Select value={sub.kind} onChange={(e) => setSub({ ...sub, kind: e.target.value })}>
                  <option value="">— Không ghi —</option>
                  <option value="TEMPORARY">Tạm trú</option>
                  <option value="WORK">Nơi làm việc</option>
                  <option value="HOMETOWN">Quê quán</option>
                  <option value="OTHER">Khác</option>
                </Select>
              </Field>
            </>
          ) : null}

          {adding === 'education' ? (
            <>
              <Field label="Trường" className="sm:col-span-2">
                <Input
                  value={sub.school}
                  onChange={(e) => setSub({ ...sub, school: e.target.value })}
                />
              </Field>
              <Field label="Chuyên ngành">
                <Input
                  value={sub.major}
                  onChange={(e) => setSub({ ...sub, major: e.target.value })}
                />
              </Field>
              <Field label="Bằng cấp">
                <Input
                  value={sub.degree}
                  onChange={(e) => setSub({ ...sub, degree: e.target.value })}
                />
              </Field>
              <Field label="Năm tốt nghiệp">
                <Input
                  type="number"
                  min={1900}
                  max={2200}
                  value={sub.graduationYear}
                  onChange={(e) => setSub({ ...sub, graduationYear: e.target.value })}
                />
              </Field>
            </>
          ) : null}

          {adding === 'bank-accounts' ? (
            <>
              <Field label="Mã ngân hàng" required hint="VCB, BIDV, TCB…">
                <Input
                  value={sub.bankCode}
                  onChange={(e) => setSub({ ...sub, bankCode: e.target.value })}
                  required
                />
              </Field>
              <Field label="Số tài khoản" required>
                <Input
                  value={sub.accountNumber}
                  onChange={(e) => setSub({ ...sub, accountNumber: e.target.value })}
                  required
                />
              </Field>
              <Field label="Chủ tài khoản" className="sm:col-span-2">
                <Input
                  value={sub.accountHolder}
                  onChange={(e) => setSub({ ...sub, accountHolder: e.target.value })}
                />
              </Field>
            </>
          ) : null}

          {adding !== 'education' ? (
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={sub.isPrimary}
                onChange={(e) => setSub({ ...sub, isPrimary: e.target.checked })}
                className="size-4 rounded border-input"
              />
              Đặt làm mục chính (hạ cờ của mục chính cũ)
            </label>
          ) : null}
        </form>
      </Dialog>
    </section>
  );
}

function SubCard({
  icon: Icon,
  title,
  hint,
  onAdd,
  empty,
  emptyText,
  children,
}: {
  icon: typeof Phone;
  title: string;
  hint?: string;
  onAdd: () => void;
  empty: boolean;
  emptyText: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <Icon className="size-4" aria-hidden />
            {title}
          </CardTitle>
          {hint !== undefined ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        <Button variant="ghost" size="sm" onClick={onAdd}>
          <Plus className="size-4" aria-hidden />
          Thêm
        </Button>
      </CardHeader>
      <CardContent>
        {empty ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <ul className="divide-y divide-border">{children}</ul>
        )}
      </CardContent>
    </Card>
  );
}

function SubRow({
  main,
  meta,
  primary,
  masked = false,
  onRemove,
}: {
  main: string;
  meta: string | null;
  primary: boolean;
  masked?: boolean;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-2 text-sm">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {masked ? (
            <span className="font-mono">
              <Masked value={main} />
            </span>
          ) : (
            <span className="truncate">{main}</span>
          )}
          {primary ? <Badge variant="default">Chính</Badge> : null}
        </div>
        {meta !== null ? <p className="text-xs text-muted-foreground">{meta}</p> : null}
      </div>
      {/* "Ngừng dùng" chứ không "Xoá": hồ sơ nhân thân đã từng đúng thì vẫn phải đọc lại
          được khi đối chiếu giấy tờ cũ. */}
      <Button variant="ghost" size="sm" onClick={onRemove}>
        Ngừng dùng
      </Button>
    </li>
  );
}

'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Pencil,
  Trash2,
  Banknote,
  GraduationCap,
  Landmark,
  IdCard,
  MapPin,
  Phone,
  Plus,
  ScrollText,
  Users,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addPersonAddress,
  cancelBurial,
  completeBurial,
  addPersonBankAccount,
  addPersonEducation,
  addPersonPhone,
  createRelationship,
  endRelationship,
  deactivatePersonSubRecord,
  deleteCustomer,
  getCustomerDetail,
  listRelationshipTypes,
  updateCustomer,
  verifyBurial,
  searchCustomers,
  type CustomerDetail,
} from '@/lib/api';
import { burialNextStep, customerType, statusOf } from '@/lib/status';
import {
  CustomerFormTabs,
  EMPTY_CUSTOMER_FORM,
  changedOnly,
  type CustomerFormValue,
} from '@/components/customer-form';
import { birthOrder, bothDirections, relationshipLabel } from '@/lib/relationship';
import { cn } from '@/lib/utils';
import { CustomerGraveActions } from '@/components/customer-grave-actions';
import { Tabs, TabPanel, type TabItem } from '@/components/ui/tabs';
import { CustomerTagsCard } from '@/components/customer-tags';
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

/* Con số trên tab cho biết bên trong có gì mà không phải mở ra xem. Tab rỗng vẫn hiện —
 * ẩn nó đi thì người dùng không biết hệ có phần đó. */
function TABS(c: CustomerDetail): TabItem[] {
  const p = c.person;
  return [
    { id: 'nhan-than', label: 'Nhân thân', icon: IdCard },
    {
      id: 'lien-lac',
      label: 'Liên lạc',
      icon: Phone,
      count: (p?.phones.length ?? 0) + (p?.addresses.length ?? 0),
    },
    { id: 'phan-mo', label: 'Phần mộ', icon: Landmark, count: c.gravePlots.length },
    {
      /* TÁCH khỏi "Phần mộ", không gộp. "Phần mộ" = mộ khách ĐỨNG TÊN; "Nơi an nghỉ" = mộ
       * khách NẰM TRONG. Gộp hai thứ là dựng lại đúng chỗ mập mờ đã làm hồ sơ an táng chặn
       * xoá trở nên vô hình.
       *
       * Con số chỉ đếm hồ sơ CÒN HIỆU LỰC, dù bảng bên trong liệt kê cả hồ sơ đã huỷ: con
       * số này phải khớp với con số trong lời từ chối xoá, còn bảng thì phải kể được lịch
       * sử. Hai câu hỏi khác nhau. */
      id: 'noi-an-nghi',
      label: 'Nơi an nghỉ',
      icon: ScrollText,
      count: c.restingPlaces.filter((r) => r.status !== 'Cancelled').length,
    },
    { id: 'quan-he', label: 'Quan hệ', icon: Users, count: c.relationships.length },
    {
      id: 'khac',
      label: 'Học vấn & ngân hàng',
      icon: Banknote,
      count: (p?.education.length ?? 0) + (p?.bankAccounts.length ?? 0),
    },
  ];
}

/* Đổ hồ sơ hiện tại vào form sửa.
 *
 * CCCD CỐ Ý để trống: cái hệ đang giữ là bản đã che (`079***123`), và đổ nó vào ô nhập là
 * mời người dùng bấm Lưu để ghi chính chuỗi che đó đè lên số thật. Trống = giữ nguyên.
 *
 * Ngày về dạng `yyyy-MM-dd` cho ô <input type="date">; ngày đã bị lớp che rút thành NĂM
 * thì bỏ trống, vì "2021" không phải một ngày và ô lịch sẽ từ chối nó.
 */
function toDateInput(v: string | null): string {
  if (v === null || v === '' || /^\d{4}$/.test(v)) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function formFromCustomer(c: CustomerDetail): CustomerFormValue {
  const p = c.person;
  return {
    type: c.type,
    fullName: p?.fullName ?? '',
    gender: p?.gender ?? '',
    dateOfBirth: toDateInput(p?.dateOfBirth ?? null),
    placeOfBirth: p?.placeOfBirth ?? '',
    nationalId: '',
    nationalIdIssuedOn: toDateInput(p?.nationalIdIssuedOn ?? null),
    nationalIdIssuedPlace: p?.nationalIdIssuedPlace ?? '',
    permanentAddress: p?.permanentAddress ?? '',
    contactAddress: p?.contactAddress ?? '',
    ethnicity: p?.ethnicity ?? '',
    religion: p?.religion ?? '',
    orgName: c.orgName ?? '',
    phone: c.phone ?? '',
    email: c.email ?? '',
  };
}

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const router = useRouter();
  const [adding, setAdding] = useState<SubKind | null>(null);
  const [relOpen, setRelOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [tab, setTab] = useState('nhan-than');
  const [editTab, setEditTab] = useState('chung');
  const [editForm, setEditForm] = useState<CustomerFormValue>(EMPTY_CUSTOMER_FORM);
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

  /* CHIỀU LƯU TRỮ: `source --CODE--> target` nghĩa là "source LÀ code của target".
   *
   * Bản trước gửi ngược: nó đặt khách hàng làm `source` trong khi nhãn trên màn hình nói
   * "người kia là gì của khách hàng". Kết quả là dòng ghi vào CSDL mang nghĩa trái với
   * điều người nhập vừa đọc — và `resolveOwnerRelationship` bên an táng đọc theo đúng quy
   * ước, nên nó sẽ suy ra quan hệ ngược khi đặt cốt.
   *
   * Đúng phải là: người vừa chọn làm `source`, khách hàng làm `target`. */
  const addRel = useMutation({
    mutationFn: () => {
      const personId = detail.data?.personId;
      if (personId === null || personId === undefined) {
        throw new Error('Khách hàng tổ chức không có hồ sơ nhân thân');
      }
      return createRelationship({
        sourcePersonId: rel.targetPersonId,
        targetPersonId: personId,
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

  /* Chọn nhầm thì sửa được: chấm dứt quan hệ cũ rồi khai lại. KHÔNG sửa tại chỗ — quan
   * hệ có hiệu lực theo thời gian, và ghi đè là xoá mất việc "trước đây đã từng khai
   * khác". Server đóng cả dòng đối ứng trong cùng giao dịch. */
  /* Huỷ hồ sơ an táng ngay trên hồ sơ khách hàng. Không bắt người dùng đi sang màn hình
   * an táng tìm lại: thứ đang CHẶN họ hiện ở đây, nên thao tác gỡ nó cũng phải ở đây. */
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const cancelBurialRecord = useMutation({
    mutationFn: () => cancelBurial(cancelTarget!, cancelReason),
    onSuccess: () => {
      setCancelTarget(null);
      setCancelReason('');
      refresh();
    },
  });

  /* Đẩy hồ sơ an táng đi TIẾP, ngay tại chỗ nó hiện ra.
   *
   * Trước 27/08/2026 hai nút này CHỈ có ở `/cemetery/burials`. Nên người vừa an táng xong ở
   * hồ sơ khách hàng không có đường đi tiếp — phải tự biết mà sang màn hình khác. Chú thích
   * của nút Huỷ ngay trên đã nói đúng nguyên tắc ("không bắt người dùng đi sang màn hình
   * khác") nhưng chỉ áp cho đường GỠ, không áp cho đường TỚI.
   *
   * `variables` giữ id dòng đang chạy: dùng `isPending` trần thì MỌI dòng cùng quay vòng khi
   * bấm một dòng — bẫy đã ghi trong bản ghi giao diện. */
  const advanceBurial = useMutation({
    mutationFn: ({ id: recordId, action }: { id: string; action: 'verify' | 'complete' }) =>
      action === 'verify' ? verifyBurial(recordId) : completeBurial(recordId),
    onSuccess: refresh,
  });

  const endRel = useMutation({
    mutationFn: (relationshipId: string) => endRelationship(relationshipId),
    onSuccess: refresh,
  });

  /* Chỉ gửi trường THỰC SỰ đổi. Gửi cả hồ sơ thì audit ghi 15 trường "đã đổi" trong khi
   * người dùng chỉ sửa một — và nhật ký như thế thì không dùng để rà soát được. */
  const saveEdit = useMutation({
    mutationFn: () => {
      const base = formFromCustomer(c);
      const diff = changedOnly(editForm, base);
      const { type, orgName, phone, email, ...personFields } = diff;
      const person = Object.fromEntries(
        Object.entries(personFields).filter(([, v]) => v !== undefined),
      );
      return updateCustomer(id, {
        ...(type !== undefined ? { type } : {}),
        ...(orgName !== undefined ? { orgName } : {}),
        ...(phone !== undefined ? { phone } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(Object.keys(person).length > 0 ? { person } : {}),
      });
    },
    onSuccess: () => {
      setEditOpen(false);
      refresh();
      void qc.invalidateQueries({ queryKey: ['customers'] });
    },
  });

  const removeCustomer = useMutation({
    mutationFn: () => deleteCustomer(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['customers'] });
      router.push('/cemetery/customers');
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

  /* Bỏ khách tổ chức (không có nhân thân) và bỏ chính khách hàng này: server chặn quan hệ
   * với chính mình, nên đừng mời người dùng chọn một lựa chọn chắc chắn lỗi. */
  const relCandidates = (relCustomers.data ?? []).filter(
    (x) => x.person !== null && x.person.id !== detail.data?.personId,
  );
  const chosenPerson = relCandidates.find((x) => x.person?.id === rel.targetPersonId);

  if (detail.isPending) {
    return <p className="text-sm text-muted-foreground">Đang tải hồ sơ…</p>;
  }
  if (detail.error !== null) {
    return <Alert variant="destructive">{(detail.error as Error).message}</Alert>;
  }

  const c: CustomerDetail = detail.data;
  const p = c.person;
  const name = p?.fullName ?? c.orgName ?? c.customerCode;

  /* Hồ sơ an táng ĐANG CHẶN xoá — dùng CÙNG một định nghĩa "còn hiệu lực" với server (mọi
   * thứ không phải `Cancelled`). Hai chỗ trả lời khác nhau cho cùng một câu hỏi nghiệp vụ
   * chính là bệnh mà `common/lifecycle/active.ts` sinh ra để chữa.
   *
   * Là dẫn xuất thường, KHÔNG phải hook — nên nó nằm dưới hai early return được. Thêm
   * `useQuery`/`useMemo` ở đây thì phải đưa lên trên chúng. */
  const blockingBurials = c.restingPlaces.filter((r) => r.status !== 'Cancelled');

  /* Hai câu xác nhận trước khi lưu. `source` là NGƯỜI VỪA CHỌN, `target` là khách hàng
   * này — đúng chiều sẽ ghi xuống CSDL, nên câu hiện ra chính là điều sắp được lưu, không
   * phải một bản diễn giải gần đúng. */
  const relPreview =
    chosenPerson?.person != null && p !== null && rel.relationshipType !== ''
      ? bothDirections(
          {
            fullName: chosenPerson.person.fullName,
            gender: chosenPerson.person.gender,
            dateOfBirth: chosenPerson.person.dateOfBirth,
          },
          { fullName: p.fullName, gender: p.gender, dateOfBirth: p.dateOfBirth },
          rel.relationshipType,
        )
      : null;

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
          <>
            {/* `Link` mang class của nút, KHÔNG bọc `Link` trong `Button`: `<a>` lồng
                trong `<button>` là HTML không hợp lệ và trình duyệt tự gỡ ra. */}
            <Link
              href="/cemetery/customers"
              className={cn(buttonVariants({ variant: 'secondary' }), 'gap-1.5')}
            >
              <ArrowLeft className="size-4" aria-hidden />
              Về danh sách
            </Link>
            <Button
              variant="secondary"
              onClick={() => {
                /* Nạp giá trị HIỆN TẠI vào form mỗi lần mở, không giữ lại lần sửa trước:
                   mở ra thấy dữ liệu cũ của lần bấm trước là chỗ người dùng lưu nhầm. */
                setEditForm(formFromCustomer(c));
                setEditTab('chung');
                setEditOpen(true);
              }}
            >
              <Pencil className="size-4" aria-hidden />
              Sửa
            </Button>
            <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="size-4" aria-hidden />
              Xoá
            </Button>
          </>
        }
      />

      {addSub.error !== null ? (
        <Alert variant="destructive">{(addSub.error as Error).message}</Alert>
      ) : null}
      {deactivate.error !== null ? (
        <Alert variant="destructive">{(deactivate.error as Error).message}</Alert>
      ) : null}

      <Tabs items={TABS(c)} value={tab} onChange={setTab}>
        <TabPanel id="nhan-than" value={tab}>
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

          {/* Thẻ nhãn đặt ở tab NHÂN THÂN vì đây là chỗ người dùng nhìn để hiểu hồ sơ này
              đang thiếu gì. Không đặt ở tab riêng: một tab chỉ để xem hai cái nhãn là một
              cú bấm thừa cho thứ phải thấy ngay. */}
          <div className="mt-6">
            <CustomerTagsCard customerId={c.id} />
          </div>
        </TabPanel>

        <TabPanel id="lien-lac" value={tab}>
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
            </div>
          ) : null}
        </TabPanel>

        <TabPanel id="phan-mo" value={tab}>
          <CustomerGraveActions customer={c} onChanged={refresh} />
        </TabPanel>

        <TabPanel id="noi-an-nghi" value={tab}>
          <Card>
            <CardHeader>
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  <ScrollText className="size-4" aria-hidden />
                  Nơi an nghỉ
                </CardTitle>
                {/* Nói rõ khối này KHÁC tab "Phần mộ" ở chỗ nào — hai tab cùng nói về mộ
                    mà không phân biệt được thì người đọc sẽ tưởng một trong hai sai. */}
                <p className="text-xs text-muted-foreground">
                  Mộ mà khách hàng này NẰM TRONG, khác với tab “Phần mộ” là mộ họ đứng tên. Hồ sơ
                  còn hiệu lực ở đây sẽ CHẶN xoá hồ sơ khách hàng.
                </p>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Phần mộ</TableHead>
                    <TableHead>Cốt</TableHead>
                    <TableHead>Chủ mộ</TableHead>
                    <TableHead>Ngày an táng</TableHead>
                    <TableHead>Trạng thái</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {c.restingPlaces.length === 0 ? (
                    <TableMessage colSpan={6}>
                      <EmptyState
                        icon={ScrollText}
                        title="Chưa an táng ở phần mộ nào"
                        description="Khách hàng này chưa có hồ sơ an táng nào ghi họ là người mất."
                      />
                    </TableMessage>
                  ) : (
                    c.restingPlaces.map((r) => {
                      const s = statusOf(r.status);
                      const cancelled = r.status === 'Cancelled';
                      // Bước còn thiếu — luật khai một lần ở `lib/status`, ba màn hình dùng chung.
                      const next = burialNextStep(r.status);
                      return (
                        <TableRow key={r.burialRecordId}>
                          <TableCell>
                            <span className="block font-medium">{r.plotCode ?? '—'}</span>
                            <span className="block text-xs text-muted-foreground">
                              {r.cemeteryName ?? ''}
                            </span>
                          </TableCell>
                          <TableCell>{r.slotNumber ?? '—'}</TableCell>
                          <TableCell>
                            {/* Quan hệ hiện NHƯ ĐÃ LƯU lúc đặt cốt, không tính lại từ tab
                                Quan hệ: chủ mộ có thể đã đổi vì kế thừa, quan hệ có thể đã
                                chấm dứt, nhưng căn cứ hồi đó thì không đổi. */}
                            <span className="block">{r.ownerName ?? '—'}</span>
                            <span className="block text-xs text-muted-foreground">
                              {r.relationshipToOwner === null
                                ? ''
                                : r.relationshipToOwner === 'SELF'
                                  ? 'chính chủ mộ'
                                  : /* Giới tính của CHÍNH người này — nhãn là "người này
                                       LÀ GÌ của chủ mộ", nên "con trai"/"con gái" suy từ
                                       giới tính của họ. Thứ tự sinh để `null`: so tuổi với
                                       chủ mộ cần ngày sinh của chủ mộ, mà bản ghi an táng
                                       không chụp lại thứ đó — đoán bừa "anh" hay "em" là
                                       sai một điều người ta để ý. */
                                    relationshipLabel(r.relationshipToOwner, p?.gender ?? null)}
                            </span>
                          </TableCell>
                          <TableCell>{r.burialDate?.slice(0, 10) ?? '—'}</TableCell>
                          <TableCell>
                            <Badge variant={s.variant}>{s.label}</Badge>
                            {/* "Nháp" một mình là một từ không giải thích gì. Nói luôn còn
                                thiếu bước nào — cùng luật với nút bị chặn phải nói lý do. */}
                            {next !== null ? (
                              <span className="block text-xs text-muted-foreground">
                                {next.hint}
                              </span>
                            ) : null}
                            {cancelled && r.cancelReason !== null ? (
                              <span className="block text-xs text-muted-foreground">
                                {r.cancelReason}
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            {/* Hồ sơ HOÀN TẤT không có nút: người đã nằm trong mộ, và một
                                nút bấm được rồi mới báo lỗi là mời người dùng va vào luật. */}
                            <div className="flex flex-wrap justify-end gap-1">
                              {next !== null ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  loading={
                                    advanceBurial.isPending &&
                                    advanceBurial.variables?.id === r.burialRecordId
                                  }
                                  onClick={() =>
                                    advanceBurial.mutate({
                                      id: r.burialRecordId,
                                      action: next.action,
                                    })
                                  }
                                >
                                  {next.label}
                                </Button>
                              ) : null}
                              {cancelled || r.status === 'Completed' ? null : (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setCancelTarget(r.burialRecordId)}
                                  title="Huỷ hồ sơ an táng này — cốt được nhả ra cho người khác"
                                >
                                  Huỷ hồ sơ
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabPanel>

        <TabPanel id="quan-he" value={tab}>
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
                    <TableHead>Quan hệ</TableHead>
                    <TableHead>Trạng thái</TableHead>
                    <TableHead />
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
                    c.relationships.map((r) => {
                      /* Dòng lưu là "khách hàng này LÀ relationshipType của target". Hiện
                     thành CÂU đủ hai chiều thay vì hai cột rời — hai cột rời là chỗ người
                     đọc phải tự đoán ai là gì của ai, và đoán sai thì không ai biết. */
                      const both =
                        p === null
                          ? null
                          : bothDirections(
                              {
                                fullName: p.fullName,
                                gender: p.gender,
                                dateOfBirth: p.dateOfBirth,
                              },
                              {
                                fullName: r.target.fullName,
                                gender: r.target.gender,
                                dateOfBirth: r.target.dateOfBirth,
                              },
                              r.relationshipType,
                            );
                      return (
                        <TableRow key={r.id}>
                          <TableCell>
                            <span className="block font-medium">
                              {both?.forward ?? r.relationshipType}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {both?.backward ?? ''}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge variant={r.status === 'Confirmed' ? 'success' : 'warning'}>
                              {r.status === 'Confirmed' ? 'Đã xác nhận' : r.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={endRel.isPending}
                              onClick={() => endRel.mutate(r.id)}
                              title="Chấm dứt quan hệ này rồi khai lại cho đúng"
                            >
                              Chấm dứt
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabPanel>

        <TabPanel id="khac" value={tab}>
          {p !== null ? (
            <div className="grid gap-6 lg:grid-cols-2">
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
        </TabPanel>
      </Tabs>

      <Dialog
        open={relOpen}
        onClose={() => setRelOpen(false)}
        title="Khai quan hệ nhân thân"
        description="Chọn người, rồi chọn NGƯỜI ĐÓ là gì của khách hàng này."
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

          {/* Ô tìm và danh sách kết quả gộp làm một. Trước đây tách thành ô nhập rời với
              ô chọn rời: gõ xong vẫn phải mở ô thứ hai, và ô thứ hai không cho thấy giới
              tính hay tuổi — hai thứ quyết định nhãn quan hệ. */}
          <Field label="Tìm người" hint="Gõ tên hoặc mã KH. Người mất cũng là khách hàng.">
            <Input
              value={rel.q}
              onChange={(e) => setRel({ ...rel, q: e.target.value })}
              placeholder="Họ tên, mã KH…"
              autoFocus
            />
          </Field>

          <div className="max-h-48 overflow-y-auto rounded-md border">
            {relCandidates.length === 0 ? (
              <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                {rel.q === '' ? 'Gõ để tìm khách hàng.' : 'Không tìm thấy ai khớp.'}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {relCandidates.map((x) => (
                  <li key={x.id}>
                    <button
                      type="button"
                      onClick={() => setRel({ ...rel, targetPersonId: x.person?.id ?? '' })}
                      className={cn(
                        'flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-accent/50',
                        rel.targetPersonId === x.person?.id ? 'bg-accent' : '',
                      )}
                    >
                      <span>
                        <span className="font-medium">{x.person?.fullName}</span>
                        <span className="block text-xs text-muted-foreground">
                          {x.customerCode} · {GENDER[x.person?.gender ?? ''] ?? 'Chưa rõ giới tính'}
                          {x.isDeceased ? ' · đã mất' : ''}
                        </span>
                      </span>
                      {rel.targetPersonId === x.person?.id ? (
                        <Badge variant="default">Đã chọn</Badge>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Field
            label={`Người đó là gì của ${name}`}
            hint={
              chosenPerson === undefined
                ? 'Chọn người trước để hệ đặt đúng nhãn theo giới tính.'
                : chosenPerson.person?.gender == null
                  ? 'Người này chưa khai giới tính nên nhãn để dạng chung.'
                  : undefined
            }
          >
            <Select
              value={rel.relationshipType}
              disabled={chosenPerson === undefined}
              onChange={(e) => setRel({ ...rel, relationshipType: e.target.value })}
            >
              <option value="">— Chọn quan hệ —</option>
              {(relTypes.data ?? []).map((t) => (
                <option key={t.code} value={t.code}>
                  {/* Nhãn theo GIỚI TÍNH của người vừa chọn: "Bố đẻ" hay "Mẹ đẻ", không
                      phải "Cha/Mẹ" chung chung. */}
                  {relationshipLabel(
                    t.code,
                    chosenPerson?.person?.gender ?? null,
                    birthOrder(chosenPerson?.person?.dateOfBirth ?? null, p?.dateOfBirth ?? null),
                  )}
                </option>
              ))}
            </Select>
          </Field>

          {/* Xác nhận CẢ HAI CHIỀU trước khi lưu. Quan hệ vốn hai chiều nhưng người nhập
              chỉ khai một chiều — hiện đủ hai câu thì không còn chỗ hiểu ngược, và người
              nhập tự thấy mình chọn sai trước khi bấm. */}
          {relPreview !== null ? (
            <Alert variant="info" title="Sẽ ghi nhận">
              <p>{relPreview.forward}</p>
              <p>{relPreview.backward}</p>
            </Alert>
          ) : null}
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
      <Dialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Sửa hồ sơ khách hàng"
        description="Ô để trống nghĩa là XOÁ giá trị cũ. Chỉ trường thực sự đổi mới được gửi đi."
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditOpen(false)}>
              Huỷ
            </Button>
            <Button form="edit-form" type="submit" loading={saveEdit.isPending}>
              {saveEdit.isPending ? 'Đang lưu…' : 'Lưu thay đổi'}
            </Button>
          </>
        }
      >
        <form
          id="edit-form"
          onSubmit={(e) => {
            e.preventDefault();
            saveEdit.mutate();
          }}
        >
          {saveEdit.error !== null ? (
            <Alert variant="destructive" title="Không lưu được" className="mb-4">
              {(saveEdit.error as Error).message}
            </Alert>
          ) : null}

          {/* CCCD hiện ra dạng đã che, nên ô CCCD để TRỐNG khi mở form. Đổ `079***123` vào
              ô nhập là mời người dùng lưu lại chính chuỗi che đó đè lên số thật. */}
          <Alert variant="info" className="mb-4">
            Ô CCCD để trống = giữ nguyên số cũ. Nhập số mới nếu muốn thay.
          </Alert>

          <CustomerFormTabs
            value={editForm}
            onChange={(patch) => setEditForm((f) => ({ ...f, ...patch }))}
            tab={editTab}
            onTabChange={setEditTab}
            lockType
          />
        </form>
      </Dialog>

      <Dialog
        open={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        title="Huỷ hồ sơ an táng"
        description="Cốt sẽ được nhả ra cho người khác nhận."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelTarget(null)}>
              Đóng
            </Button>
            <Button
              variant="destructive"
              loading={cancelBurialRecord.isPending}
              disabled={cancelReason.trim().length < 3}
              onClick={() => cancelBurialRecord.mutate()}
            >
              Huỷ hồ sơ
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {cancelBurialRecord.error !== null ? (
            <Alert variant="destructive" title="Không huỷ được">
              {(cancelBurialRecord.error as Error).message}
            </Alert>
          ) : null}
          {/* LÝ DO là bắt buộc ở server, nên phải bắt buộc ở đây luôn — để người dùng biết
              trước khi bấm, thay vì bấm rồi nhận 400. */}
          <Field
            label="Lý do huỷ"
            hint="Bắt buộc. Sáu tháng sau đây là thứ duy nhất kể được vì sao cốt này từng bị giữ rồi lại trống."
          >
            <Input
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="ví dụ: nhập nhầm người"
            />
          </Field>
          <p className="text-xs text-muted-foreground">
            Hồ sơ KHÔNG bị xoá — nó chuyển sang “Đã hủy” và vẫn đọc lại được. Hồ sơ đã HOÀN TẤT thì
            không huỷ được: đưa người ra khỏi mộ là thủ tục di dời/cải táng.
          </p>
        </div>
      </Dialog>

      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Xoá hồ sơ khách hàng"
        description="Không lấy lại được."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
              Huỷ
            </Button>
            <Button
              variant="destructive"
              loading={removeCustomer.isPending}
              onClick={() => removeCustomer.mutate()}
            >
              Xoá hẳn
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {removeCustomer.error !== null ? (
            <Alert variant="destructive" title="Không xoá được">
              {(removeCustomer.error as Error).message}
            </Alert>
          ) : null}

          <p className="text-sm">
            Xoá <strong>{name}</strong> ({c.customerCode})?
          </p>

          {/* Nói TRƯỚC cái sẽ mất theo. Xoá xong mới biết mình vừa làm gì là quá muộn. */}
          <Alert variant="warning" title="Sẽ xoá theo">
            <ul className="list-disc space-y-0.5 pl-5">
              <li>Hồ sơ nhân thân và toàn bộ số điện thoại, địa chỉ, học vấn, tài khoản</li>
              <li>
                {c.relationships.length} quan hệ nhân thân — người bên kia cũng mất quan hệ này khỏi
                hồ sơ của họ
              </li>
              {p?.deceased != null ? <li>Hồ sơ người mất</li> : null}
            </ul>
          </Alert>

          {/* Nói TRƯỚC cái đang chặn, chỉ đích danh, thay vì để người dùng bấm rồi mới
              biết. Trước 27/08/2026 chỗ này chỉ có một câu chung chung, còn hồ sơ an táng
              đang chặn thì không hiện ở đâu trên trang — nên lời từ chối của server đọc
              lên như một lỗi của hệ. */}
          {blockingBurials.length > 0 ? (
            <Alert variant="destructive" title="Đang bị chặn">
              <p>Khách hàng này đã được an táng — phải huỷ hồ sơ an táng trước khi xoá:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {blockingBurials.map((r) => (
                  <li key={r.burialRecordId}>
                    mộ {r.plotCode ?? r.gravePlotId}
                    {r.slotNumber === null ? '' : ` cốt ${r.slotNumber}`} —{' '}
                    {statusOf(r.status).label}
                    {r.status === 'Completed' ? ' (không huỷ được)' : ''}
                  </li>
                ))}
              </ul>
              <p className="mt-1">Xem tab “Nơi an nghỉ”.</p>
            </Alert>
          ) : null}

          <p className="text-xs text-muted-foreground">
            Hệ sẽ TỪ CHỐI nếu khách hàng còn đứng tên mộ, có hồ sơ an táng, đã cấp thẻ, có hợp đồng
            hoặc dịch vụ — và nói rõ cái nào đang chặn.
          </p>
        </div>
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

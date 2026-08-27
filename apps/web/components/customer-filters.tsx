'use client';

import { useQuery } from '@tanstack/react-query';
import { RotateCcw, Search } from 'lucide-react';
import {
  listCemeteries,
  listCompanies,
  type CustomerFilters,
  type GraveOwnerFilter,
  type LifeStatus,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/label';

/* Thanh lọc danh sách khách hàng.
 *
 * MỌI trục ở đây lọc Ở SERVER — component này chỉ dựng giá trị rồi đưa lên. Lọc phía client
 * là sai, và sai theo kiểu không ai phát hiện: truy vấn cắt ở 50 dòng, nên lọc trên mảng đã
 * nhận là lọc trên MỘT LÁT CẮT. "Còn 3 người đã mất" ra 0 chỉ vì 50 khách còn sống đứng
 * trước họ, và màn hình hiện con số đó với vẻ chắc chắn y hệt lúc nó đúng.
 *
 * Trục "nghĩa trang" phụ thuộc "công ty" vì API danh sách nghĩa trang đòi `companyId` —
 * không tự bịa một endpoint "mọi nghĩa trang" ra để chiều giao diện.
 */

/** Giá trị "chưa lọc gì" — khai một lần, dùng cả cho khởi tạo lẫn nút Xoá lọc. */
export const EMPTY_CUSTOMER_FILTERS: CustomerFilters = {
  q: '',
  lifeStatus: 'all',
  graveOwner: 'all',
  companyId: '',
  cemeteryId: '',
  type: '',
};

/* Đếm số trục ĐANG lọc, để người dùng thấy ngay mình đang nhìn một tập đã bị thu hẹp.
 * Không đếm `q`: ô tìm luôn hiện sẵn nội dung nó, còn các trục kia thì phải cuộn mới thấy. */
export function activeFilterCount(f: CustomerFilters): number {
  let n = 0;
  if (f.lifeStatus !== undefined && f.lifeStatus !== 'all') n += 1;
  if (f.graveOwner !== undefined && f.graveOwner !== 'all') n += 1;
  if (f.companyId !== undefined && f.companyId !== '') n += 1;
  if (f.cemeteryId !== undefined && f.cemeteryId !== '') n += 1;
  if (f.type !== undefined && f.type !== '') n += 1;
  return n;
}

export function CustomerFiltersBar({
  value,
  onChange,
}: {
  value: CustomerFilters;
  onChange: (next: CustomerFilters) => void;
}) {
  const companies = useQuery({ queryKey: ['companies'], queryFn: listCompanies });
  const companyId = value.companyId ?? '';
  const cemeteries = useQuery({
    queryKey: ['cemeteries', companyId],
    queryFn: () => listCemeteries(companyId),
    enabled: companyId !== '',
  });

  const set = (patch: Partial<CustomerFilters>) => onChange({ ...value, ...patch });
  const active = activeFilterCount(value);

  /* Đổi công ty thì XOÁ nghĩa trang đang chọn. Giữ lại là giữ một id thuộc công ty cũ, và
   * server sẽ từ chối nó — người dùng nhận 403 cho một thao tác họ không hề làm. */
  const setCompany = (id: string) => set({ companyId: id, cemeteryId: '' });

  return (
    <div className="space-y-3">
      <div className="relative max-w-md">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          className="pl-9"
          placeholder="Tìm theo tên, mã KH, điện thoại, email…"
          value={value.q ?? ''}
          onChange={(e) => set({ q: e.target.value })}
          aria-label="Tìm khách hàng"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Tình trạng" htmlFor="f-life">
          <Select
            id="f-life"
            value={value.lifeStatus ?? 'all'}
            onChange={(e) => set({ lifeStatus: e.target.value as LifeStatus })}
          >
            <option value="all">Tất cả</option>
            <option value="alive">Còn sống</option>
            {/* Khách TỔ CHỨC không sống cũng không mất, nên hai lựa chọn dưới đây loại họ
                ra — đúng nghiệp vụ, và nhắc luôn ở đây để không ai tưởng là sót dữ liệu. */}
            <option value="deceased">Đã mất</option>
          </Select>
        </Field>

        <Field label="Phần mộ" htmlFor="f-grave">
          <Select
            id="f-grave"
            value={value.graveOwner ?? 'all'}
            onChange={(e) => set({ graveOwner: e.target.value as GraveOwnerFilter })}
          >
            <option value="all">Tất cả</option>
            <option value="yes">Đang đứng tên mộ</option>
            <option value="no">Chưa đứng tên mộ</option>
          </Select>
        </Field>

        <Field label="Loại khách" htmlFor="f-type">
          <Select
            id="f-type"
            value={value.type ?? ''}
            onChange={(e) => set({ type: e.target.value })}
          >
            <option value="">Tất cả</option>
            <option value="INDIVIDUAL">Cá nhân</option>
            <option value="ORGANIZATION">Tổ chức</option>
            <option value="AGENT">Đại lý</option>
            <option value="PROSPECT">Tiềm năng</option>
          </Select>
        </Field>

        <Field label="Công ty" htmlFor="f-company">
          <Select
            id="f-company"
            value={companyId}
            onChange={(e) => setCompany(e.target.value)}
            disabled={companies.isPending}
          >
            {/* Danh sách công ty đã là PHẠM VI của người gọi (server bó sẵn), nên "Tất cả"
                ở đây nghĩa là "mọi công ty tôi phụ trách", không phải mọi công ty trong hệ. */}
            <option value="">Tất cả</option>
            {companies.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Nghĩa trang"
          htmlFor="f-cemetery"
          hint={companyId === '' ? 'Chọn công ty trước' : undefined}
        >
          <Select
            id="f-cemetery"
            value={value.cemeteryId ?? ''}
            onChange={(e) => set({ cemeteryId: e.target.value })}
            disabled={companyId === '' || cemeteries.isPending}
          >
            <option value="">Tất cả</option>
            {cemeteries.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {active > 0 ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Đang lọc {active} tiêu chí</span>
          <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_CUSTOMER_FILTERS)}>
            <RotateCcw aria-hidden />
            Xoá lọc
          </Button>
        </div>
      ) : null}
    </div>
  );
}

'use client';

import { BadgeCheck, IdCard, MapPin } from 'lucide-react';
import { Field } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Tabs, TabPanel, type TabItem } from '@/components/ui/tabs';

/* Form hồ sơ khách hàng, dùng chung cho THÊM MỚI và SỬA.
 *
 * Một bộ trường, hai chỗ dùng: nếu tách làm hai thì mỗi lần thêm một trường phải nhớ sửa
 * cả hai, và chỗ quên sẽ là chỗ người dùng nhập được lúc tạo nhưng không sửa lại được.
 *
 * Chia tab vì hồ sơ có hơn 15 trường thuộc ba nhóm nghiệp vụ khác nhau. Một cột dài thì
 * người nhập không thấy được hồ sơ gồm những phần nào nếu không cuộn hết.
 */

export interface CustomerFormValue {
  type: string;
  /* Công ty chủ quản. BẮT BUỘC lúc tạo, SỬA ĐƯỢC ở màn hồ sơ (anh Bách chốt 09/09/2026).
   *
   * Nằm trong `CustomerFormValue` chứ không dựng riêng ở từng trang: một bộ trường, hai chỗ
   * dùng — đúng lý do đã ghi ở đầu tệp. Dựng riêng thì ô này chỉ mọc ở màn tạo, và màn hồ sơ
   * lại không sửa được công ty, tức là tái lập đúng cái ngõ cụt vừa dẹp. */
  companyId: string;
  fullName: string;
  gender: string;
  dateOfBirth: string;
  placeOfBirth: string;
  nationalId: string;
  nationalIdIssuedOn: string;
  nationalIdIssuedPlace: string;
  permanentAddress: string;
  contactAddress: string;
  ethnicity: string;
  religion: string;
  orgName: string;
  phone: string;
  email: string;
}

export const EMPTY_CUSTOMER_FORM: CustomerFormValue = {
  type: 'INDIVIDUAL',
  companyId: '',
  fullName: '',
  gender: '',
  dateOfBirth: '',
  placeOfBirth: '',
  nationalId: '',
  nationalIdIssuedOn: '',
  nationalIdIssuedPlace: '',
  permanentAddress: '',
  contactAddress: '',
  ethnicity: '',
  religion: '',
  orgName: '',
  phone: '',
  email: '',
};

const TABS: TabItem[] = [
  { id: 'chung', label: 'Thông tin chung', icon: BadgeCheck },
  { id: 'giay-to', label: 'Giấy tờ & nhân khẩu', icon: IdCard },
  { id: 'dia-chi', label: 'Địa chỉ', icon: MapPin },
];

export function CustomerFormTabs({
  value,
  onChange,
  tab,
  onTabChange,
  /** Sửa hồ sơ đã có: không cho đổi loại khách hàng — đổi cá nhân thành tổ chức là bỏ hồ
   *  sơ nhân thân, và đó là việc khác chứ không phải sửa một trường. */
  lockType = false,
  /** Công ty người dùng được chọn. Danh sách này ĐÃ bó theo phạm vi ở API (`listCompanies`
   *  lọc theo `visibleCompanyIdsFor`), nên người phụ trách một công ty chỉ thấy đúng công ty
   *  đó — mời chọn rồi ăn 403 là bắt người dùng thử đến khi trúng. */
  companies = [],
  /** `null` = chọn được. Khác `null` = ô bị khoá, và CHÍNH chuỗi này là lý do hiện ra cho
   *  người dùng đọc. Một ô xám không kèm lý do là chỗ người ta ngồi đoán. */
  companyBlocked = null,
}: {
  value: CustomerFormValue;
  onChange: (patch: Partial<CustomerFormValue>) => void;
  tab: string;
  onTabChange: (id: string) => void;
  lockType?: boolean;
  companies?: { id: string; code: string; name: string }[];
  companyBlocked?: string | null;
}) {
  const individual = value.type === 'INDIVIDUAL';

  return (
    <Tabs items={TABS} value={tab} onChange={onTabChange}>
      <TabPanel id="chung" value={tab}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Loại khách hàng" htmlFor="type">
            <Select
              id="type"
              value={value.type}
              disabled={lockType}
              onChange={(e) => onChange({ type: e.target.value })}
            >
              <option value="INDIVIDUAL">Cá nhân</option>
              <option value="ORGANIZATION">Tổ chức</option>
              <option value="AGENT">Đại lý</option>
              <option value="PROSPECT">Tiềm năng</option>
            </Select>
          </Field>

          {/* CÔNG TY CHỦ QUẢN — bắt buộc lúc tạo, sửa được ở màn hồ sơ.
              Đây là NEO PHẠM VI của cả hồ sơ: danh sách khách, quyền xoá và biểu phí cấp thẻ
              đều bó theo nó. Bỏ trống là tạo ra một hồ sơ không màn hình nào bó tới được. */}
          <Field
            label="Công ty chủ quản"
            htmlFor="companyId"
            required
            {...(companyBlocked !== null
              ? { hint: companyBlocked }
              : {
                  hint: 'Quyết định ai nhìn thấy và xử lý được hồ sơ này. Đổi công ty là chuyển hồ sơ sang đơn vị khác.',
                })}
          >
            {/* KHÔNG đặt `required` lên chính ô này, dù nó là trường bắt buộc.

                Hai lý do. Một: câu chặn của trình duyệt ("Please select an item in the list")
                là TIẾNG ANH và không sửa được — nút chặn ở đây phải nói tiếng Việt, nên việc
                chặn thuộc về nút Lưu kèm câu giải thích, đúng khuôn `blocked` của repo.
                Hai: form này dùng chung cho màn SỬA, nơi một hồ sơ cũ có thể đang trống ô
                công ty — `required` sẽ chặn cả người chỉ muốn đổi số điện thoại của hồ sơ đó,
                bằng một câu họ không đọc được. Dấu sao đỏ vẫn còn (`required` trên `Field`),
                nên người nhập vẫn thấy đây là trường bắt buộc. */}
            <Select
              id="companyId"
              value={value.companyId}
              disabled={companyBlocked !== null}
              onChange={(e) => onChange({ companyId: e.target.value })}
            >
              <option value="">— Chọn công ty —</option>
              {/* Công ty ĐANG GẮN mà không nằm trong danh sách chọn được: giữ một dòng cho
                  nó, nếu không `<select>` hiện RỖNG trong khi hồ sơ vẫn có công ty — người
                  đọc tưởng hồ sơ chưa gắn ai và sẽ gán đè sang công ty khác. Danh sách này
                  bó theo `org.company.view`, còn hồ sơ thì tới từ `crm.customer.*`; hai mã
                  khác nhau nên hai phạm vi lệch nhau được. */}
              {value.companyId !== '' && !companies.some((c) => c.id === value.companyId) ? (
                <option value={value.companyId}>
                  Công ty hiện tại của hồ sơ (ngoài danh sách bạn chọn được)
                </option>
              ) : null}
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </Select>
          </Field>

          {individual ? (
            <>
              <Field label="Họ tên" htmlFor="fullName" required>
                <Input
                  id="fullName"
                  value={value.fullName}
                  onChange={(e) => onChange({ fullName: e.target.value })}
                  required
                />
              </Field>
              <Field label="Giới tính" htmlFor="gender" hint="Quyết định nhãn quan hệ nhân thân.">
                <Select
                  id="gender"
                  value={value.gender}
                  onChange={(e) => onChange({ gender: e.target.value })}
                >
                  <option value="">— Chưa rõ —</option>
                  <option value="MALE">Nam</option>
                  <option value="FEMALE">Nữ</option>
                  <option value="UNKNOWN">Không xác định</option>
                </Select>
              </Field>
              <Field label="Ngày sinh" htmlFor="dateOfBirth" hint="Dùng để phân biệt anh với em.">
                <Input
                  id="dateOfBirth"
                  type="date"
                  value={value.dateOfBirth}
                  onChange={(e) => onChange({ dateOfBirth: e.target.value })}
                />
              </Field>
            </>
          ) : (
            <Field label="Tên tổ chức" htmlFor="orgName" required>
              <Input
                id="orgName"
                value={value.orgName}
                onChange={(e) => onChange({ orgName: e.target.value })}
                required
              />
            </Field>
          )}

          <Field label="Điện thoại" htmlFor="phone">
            <Input
              id="phone"
              value={value.phone}
              onChange={(e) => onChange({ phone: e.target.value })}
            />
          </Field>
          <Field label="Email" htmlFor="email">
            <Input
              id="email"
              type="email"
              value={value.email}
              onChange={(e) => onChange({ email: e.target.value })}
            />
          </Field>
        </div>
      </TabPanel>

      <TabPanel id="giay-to" value={tab}>
        {individual ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="CCCD" htmlFor="nationalId" hint="Lưu mã hoá, hiện dạng 079***123.">
              <Input
                id="nationalId"
                value={value.nationalId}
                onChange={(e) => onChange({ nationalId: e.target.value })}
              />
            </Field>
            <Field label="Ngày cấp" htmlFor="nationalIdIssuedOn">
              <Input
                id="nationalIdIssuedOn"
                type="date"
                value={value.nationalIdIssuedOn}
                onChange={(e) => onChange({ nationalIdIssuedOn: e.target.value })}
              />
            </Field>
            <Field label="Nơi cấp" htmlFor="nationalIdIssuedPlace" className="sm:col-span-2">
              <Input
                id="nationalIdIssuedPlace"
                value={value.nationalIdIssuedPlace}
                onChange={(e) => onChange({ nationalIdIssuedPlace: e.target.value })}
              />
            </Field>
            <Field label="Nơi sinh" htmlFor="placeOfBirth">
              <Input
                id="placeOfBirth"
                value={value.placeOfBirth}
                onChange={(e) => onChange({ placeOfBirth: e.target.value })}
              />
            </Field>
            <Field
              label="Dân tộc"
              htmlFor="ethnicity"
              hint="Dữ liệu nhạy cảm NĐ13 Điều 2.4 — che ở mức cao nhất."
            >
              <Input
                id="ethnicity"
                value={value.ethnicity}
                onChange={(e) => onChange({ ethnicity: e.target.value })}
              />
            </Field>
            <Field
              label="Tôn giáo"
              htmlFor="religion"
              hint="Cần cho nghi thức tang lễ; cùng mức che với CCCD."
            >
              <Input
                id="religion"
                value={value.religion}
                onChange={(e) => onChange({ religion: e.target.value })}
              />
            </Field>
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Khách hàng tổ chức không có hồ sơ nhân thân.
          </p>
        )}
      </TabPanel>

      <TabPanel id="dia-chi" value={tab}>
        {individual ? (
          <div className="grid gap-4">
            <Field
              label="Địa chỉ thường trú"
              htmlFor="permanentAddress"
              hint="Địa chỉ in trên thẻ quản lý mộ."
            >
              <Input
                id="permanentAddress"
                value={value.permanentAddress}
                onChange={(e) => onChange({ permanentAddress: e.target.value })}
              />
            </Field>
            <Field
              label="Địa chỉ liên hệ"
              htmlFor="contactAddress"
              hint="Nếu khác thường trú. Các địa chỉ khác thêm ở tab Liên lạc sau khi lưu."
            >
              <Input
                id="contactAddress"
                value={value.contactAddress}
                onChange={(e) => onChange({ contactAddress: e.target.value })}
              />
            </Field>
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Khách hàng tổ chức chưa có mô hình địa chỉ riêng.
          </p>
        )}
      </TabPanel>
    </Tabs>
  );
}

/** Bỏ hẳn ô để trống khỏi payload TẠO MỚI — gửi rỗng là ghi chuỗi rỗng vào CSDL. */
export function pickFilled<K extends string>(key: K, v: string): Partial<Record<K, string>> {
  const t = v.trim();
  return t === '' ? {} : ({ [key]: t } as Partial<Record<K, string>>);
}

/* Payload SỬA thì ngược lại: gửi CẢ ô rỗng, vì rỗng ở đây nghĩa là "xoá giá trị cũ".
 * Chỉ gửi trường thực sự khác bản ghi hiện tại — gửi cả hồ sơ thì audit ghi 15 trường
 * "đã đổi" trong khi người dùng chỉ sửa một. */
export function changedOnly(
  next: CustomerFormValue,
  prev: CustomerFormValue,
): Partial<CustomerFormValue> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(next) as (keyof CustomerFormValue)[]) {
    if (next[k] !== prev[k]) {
      out[k] = next[k];
    }
  }
  return out as Partial<CustomerFormValue>;
}

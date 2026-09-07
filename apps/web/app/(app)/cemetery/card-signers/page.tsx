'use client';

import { useEffect, useState } from 'react';
import { Lock, PenLine } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createCardSigner,
  listCardSigners,
  listCemeteries,
  listCompanies,
  listUsers,
  updateCardSigner,
  type CardSigner,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { PageHeader } from '@/components/ui/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { TableSkeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableMessage,
  TableRow,
} from '@/components/ui/table';

/** Vai duy nhất được ký thẻ mộ — anh Bách chốt 05/09/2026. */
const SIGNER_ROLE = 'QL_NGHIA_TRANG';

function errText(e: unknown): string {
  return e instanceof Error ? e.message : 'Có lỗi xảy ra';
}

/* NGƯỜI KÝ THẺ MỘ — danh mục THEO NGHĨA TRANG (anh Bách chốt 05/09/2026).
 *
 * "Người ký là người quản lý nghĩa trang." Nên trang này không còn ô gõ họ tên nữa: chọn
 * nghĩa trang, rồi chọn người trong danh bạ nhân viên. Ai không đủ tư cách vẫn HIỆN RA kèm
 * lý do — nút bị chặn phải nói vì sao, không lặng lẽ biến mất khỏi danh sách.
 *
 * Đây là người của INDEVCO ký ở ô BÊN PHẢI tờ thẻ. Ô bên trái là CHỦ MỘ, tên khách in thẳng
 * từ hồ sơ và KHÔNG nhập ở đâu cả — trang này không đụng tới nó.
 *
 * Không có nút XOÁ, chỉ có "Ngừng dùng": thẻ đã cấp năm ngoái vẫn phải đọc ra được tên người
 * đã ký nó. Cùng nếp với danh mục thẻ nhãn.
 */
export default function CardSignersPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canView = can(user, 'cemetery.card_signer.view');
  const canEdit = can(user, 'config.card_signer.update');
  const [open, setOpen] = useState(false);
  const [companyId, setCompanyId] = useState('');
  const [cemeteryId, setCemeteryId] = useState('');

  const companies = useQuery({ queryKey: ['companies'], queryFn: listCompanies, enabled: canView });
  const cemeteries = useQuery({
    queryKey: ['cemeteries', companyId],
    queryFn: () => listCemeteries(companyId),
    enabled: canView && companyId !== '',
  });

  /* Tự chọn khi chỉ có MỘT ứng viên — không bắt người dùng bấm một lựa chọn không có lựa chọn
   * nào khác. Nhưng KHÔNG tự chọn khi có nhiều: đoán hộ ở đây là dựng người ký vào nhầm
   * nghĩa trang, và CSDL dev đang có 9 công ty mà 8 là dữ liệu thử. */
  useEffect(() => {
    const list = companies.data ?? [];
    if (companyId === '' && list.length === 1 && list[0] !== undefined) setCompanyId(list[0].id);
  }, [companies.data, companyId]);
  useEffect(() => {
    const list = cemeteries.data ?? [];
    if (list.length === 1 && list[0] !== undefined) setCemeteryId(list[0].id);
    else setCemeteryId('');
  }, [cemeteries.data]);

  const signers = useQuery({
    queryKey: ['cardSigners', cemeteryId],
    queryFn: () => listCardSigners(cemeteryId === '' ? undefined : cemeteryId),
    enabled: canView,
  });
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['cardSigners'] });

  const toggle = useMutation({
    mutationFn: (s: CardSigner) =>
      updateCardSigner(s.id, { status: s.status === 'Active' ? 'Retired' : 'Active' }),
    onSuccess: invalidate,
  });
  const setDefault = useMutation({
    mutationFn: (s: CardSigner) => updateCardSigner(s.id, { isDefault: true }),
    onSuccess: invalidate,
  });

  if (!canView) {
    return (
      <section className="space-y-6">
        <PageHeader title="Người ký thẻ mộ" />
        <Card>
          <EmptyState
            icon={Lock}
            title="Bạn không có quyền xem trang này"
            description="Cần mã quyền cemetery.card_signer.view. Liên hệ quản trị nếu công việc của bạn cần tới nó."
          />
        </Card>
      </section>
    );
  }

  const rows = signers.data ?? [];
  const active = rows.filter((s) => s.status === 'Active');
  const hasDefault = active.some((s) => s.isDefault);
  const staleActive = active.filter((s) => !s.eligible);
  const mutError = toggle.error ?? setDefault.error;

  /* MỘT chỗ quyết nút bấm được không, và trả về CHÍNH câu giải thích. Tách hai thứ đó ra là
   * cách người ta có một nút xám mà không ai nói vì sao. */
  const addBlocked: string | null = !canEdit
    ? 'cần mã quyền config.card_signer.update.'
    : cemeteryId === ''
      ? 'chọn nghĩa trang trước — mỗi nghĩa trang có người ký riêng.'
      : null;

  return (
    <section className="space-y-6">
      <PageHeader
        title="Người ký thẻ mộ"
        description="Người quản lý nghĩa trang ký ở ô bên phải tờ thẻ. Mỗi nghĩa trang một danh mục riêng."
        actions={
          <Button disabled={addBlocked !== null} onClick={() => setOpen(true)}>
            Thêm người ký
          </Button>
        }
      />

      {mutError != null && <Alert variant="destructive">{errText(mutError)}</Alert>}

      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Công ty">
            <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">— Chọn công ty —</option>
              {(companies.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Nghĩa trang"
            hint="Người ký gắn theo nghĩa trang, không dùng chung toàn hệ."
          >
            <Select
              value={cemeteryId}
              disabled={companyId === ''}
              onChange={(e) => setCemeteryId(e.target.value)}
            >
              <option value="">
                {companyId === '' ? '— Chọn công ty trước —' : '— Tất cả nghĩa trang —'}
              </option>
              {(cemeteries.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </CardContent>
      </Card>

      <Alert variant="info">
        Tờ thẻ có <strong>hai ô ký</strong>. Ô bên <strong>trái</strong> là chủ mộ — tên khách in
        thẳng từ hồ sơ, không nhập ở đây. Danh mục này là ô bên <strong>phải</strong>, dưới dòng
        “INDEVCO - XN AN LẠC VIÊN”.
        <br />
        <span className="text-muted-foreground">
          Chỉ chọn được người đang giữ vai <strong>Quản lý nghĩa trang</strong> và đã được phân công
          chính nghĩa trang đó. Họ tên và chức danh lấy từ hồ sơ nhân viên, không gõ tay.
        </span>
      </Alert>

      {/* Không có người mặc định thì mỗi lần cấp thẻ đều phải tự chọn — không sai, nhưng là
          việc lặp lại mỗi ngày, nên nói ra thay vì để người dùng tự nhận ra. */}
      {!signers.isPending && cemeteryId !== '' && active.length > 0 && !hasDefault && (
        <Alert variant="warning">
          Nghĩa trang này chưa có người ký mặc định — màn hình cấp thẻ sẽ để trống ô người ký và
          nhân viên phải chọn mỗi lần. Bấm “Đặt mặc định” ở một dòng bên dưới.
        </Alert>
      )}

      {/* Người còn ĐANG DÙNG mà đã mất tư cách là ca nguy hiểm nhất của trang này: dòng vẫn
          hiện ra bình thường, vẫn chọn được ở màn cấp thẻ, và không có lệnh UPDATE nào chạm
          vào nó nên CSDL không thể tự biết. Phải nói thẳng ra. */}
      {staleActive.length > 0 && (
        <Alert variant="warning">
          {staleActive.length} người đang dùng nhưng <strong>không còn đủ tư cách ký</strong> — họ
          đã rời vai quản lý nghĩa trang hoặc bị gỡ phân công. Ngừng dùng họ, hoặc cấp lại vai.
        </Alert>
      )}

      {!canEdit && (
        <Alert variant="info">
          Bạn xem được danh mục nhưng không sửa được — cần mã quyền{' '}
          <strong>config.card_signer.update</strong>.
        </Alert>
      )}

      <Card>
        <CardContent className="px-0 py-0">
          <Table containerClassName="rounded-none border-0 shadow-none">
            <TableHeader>
              <TableRow>
                <TableHead>Họ và tên</TableHead>
                <TableHead>Chức danh</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {signers.isPending ? <TableSkeleton rows={3} cols={4} /> : null}

              {!signers.isPending && rows.length === 0 ? (
                <TableMessage colSpan={4}>
                  <EmptyState
                    icon={PenLine}
                    title="Chưa có người ký nào"
                    description={
                      cemeteryId === ''
                        ? 'Chọn một nghĩa trang để xem danh mục người ký của nơi đó.'
                        : 'Thêm người ký để nhân viên chọn được ở màn hình cấp thẻ.'
                    }
                  />
                </TableMessage>
              ) : null}

              {rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <span className="font-medium">{s.fullName}</span>
                    {s.isDefault && (
                      <Badge variant="neutral" className="ml-2">
                        Mặc định
                      </Badge>
                    )}
                    {/* Lý do đi kèm ngay dòng đó, không gom vào một chỗ khác: người đọc đang
                        nhìn cái tên này và câu hỏi của họ là "người này bị sao". */}
                    {!s.eligible && s.ineligibleReason !== null && (
                      <p className="mt-1 text-xs text-muted-foreground">{s.ineligibleReason}</p>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">{s.title}</TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <Badge variant={s.status === 'Active' ? 'neutral' : 'outline'}>
                        {s.status === 'Active' ? 'Đang dùng' : 'Ngừng dùng'}
                      </Badge>
                      {/* Chữ, không phải màu. Màu không được là dấu hiệu duy nhất. */}
                      {!s.eligible && <Badge variant="outline">Không đủ tư cách</Badge>}
                    </div>
                  </TableCell>
                  <TableCell align="right">
                    <div className="flex justify-end gap-1">
                      {/* Người đã ngừng dùng KHÔNG đặt mặc định được — ràng buộc ở CSDL từ
                          chối, nên đừng mời người ta bấm một nút chắc chắn hỏng. Người mất tư
                          cách cũng vậy: service sẽ từ chối. */}
                      {s.status === 'Active' && !s.isDefault && s.eligible && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!canEdit}
                          loading={setDefault.isPending && setDefault.variables?.id === s.id}
                          onClick={() => setDefault.mutate(s)}
                        >
                          Đặt mặc định
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!canEdit || (s.status !== 'Active' && !s.eligible)}
                        loading={toggle.isPending && toggle.variables?.id === s.id}
                        onClick={() => toggle.mutate(s)}
                      >
                        {s.status === 'Active' ? 'Ngừng dùng' : 'Dùng lại'}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {addBlocked !== null && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          Chưa thêm được: {addBlocked}
        </p>
      )}

      {open && cemeteryId !== '' && (
        <NewSignerDialog
          cemeteryId={cemeteryId}
          cemeteryName={(cemeteries.data ?? []).find((c) => c.id === cemeteryId)?.name ?? ''}
          onClose={() => setOpen(false)}
          onDone={invalidate}
        />
      )}
    </section>
  );
}

function NewSignerDialog({
  cemeteryId,
  cemeteryName,
  onClose,
  onDone,
}: {
  cemeteryId: string;
  cemeteryName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [userId, setUserId] = useState('');
  const [isDefault, setIsDefault] = useState(false);

  /* Hỏi danh bạ với CẢ HAI bộ lọc. Lọc một trục thôi là mời người dùng chọn một người mà
   * server chắc chắn từ chối — giữ vai không tự cấp nghĩa trang, và ngược lại. */
  const candidates = useQuery({
    queryKey: ['users', SIGNER_ROLE, cemeteryId],
    queryFn: () => listUsers({ roleCode: SIGNER_ROLE, cemeteryId }),
  });

  const create = useMutation({
    mutationFn: () => createCardSigner({ userId, cemeteryId, isDefault }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });

  const people = candidates.data ?? [];
  const chosen = people.find((p) => p.id === userId);
  /* Thiếu họ tên hoặc chức danh thì tờ thẻ in ra một ô chữ ký trống. Server cũng chặn, nhưng
   * nói trước ở đây thì người dùng biết đi sửa hồ sơ nhân viên thay vì bấm rồi mới nhận lỗi. */
  const incomplete =
    chosen !== undefined &&
    ((chosen.fullName ?? '').trim() === '' || (chosen.title ?? '').trim() === '');

  const blocked: string | null = candidates.isPending
    ? 'đang tải danh sách nhân viên.'
    : people.length === 0
      ? `không có ai vừa giữ vai Quản lý nghĩa trang vừa được phân công ${cemeteryName}. Cấp vai ở Tổ chức › Gán vai, rồi phân công ở Tổ chức › Phạm vi nghĩa trang.`
      : userId === ''
        ? 'chưa chọn nhân viên.'
        : incomplete
          ? 'nhân viên này chưa có đủ họ tên và chức danh trong hồ sơ — hai thứ đó in thẳng lên tờ thẻ.'
          : null;

  return (
    <Dialog
      open
      onClose={onClose}
      title="Thêm người ký thẻ mộ"
      description={`Cho nghĩa trang ${cemeteryName}. In ở ô bên phải tờ thẻ, dưới dòng INDEVCO - XN AN LẠC VIÊN.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Thôi
          </Button>
          <Button
            disabled={blocked !== null}
            loading={create.isPending}
            onClick={() => create.mutate()}
          >
            Thêm người ký
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {create.error !== null && <Alert variant="destructive">{errText(create.error)}</Alert>}

        <Field
          label="Nhân viên"
          hint="Chỉ hiện người đang giữ vai Quản lý nghĩa trang và đã được phân công nghĩa trang này."
        >
          <Select
            value={userId}
            disabled={people.length === 0}
            onChange={(e) => setUserId(e.target.value)}
          >
            <option value="">— Chọn nhân viên —</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName ?? p.email}
                {p.title === null ? '' : ` — ${p.title}`}
              </option>
            ))}
          </Select>
        </Field>

        {/* Cho người dùng thấy ĐÚNG hai chuỗi sắp in lên giấy, trước khi bấm. Chúng chép từ
            hồ sơ nhân viên và không sửa được ở đây — nên phải nhìn được để biết có đúng không. */}
        {chosen !== undefined && (
          <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
            <p className="text-xs text-muted-foreground">Sẽ in lên tờ thẻ:</p>
            <p className="font-medium">{chosen.fullName ?? '(chưa có họ tên)'}</p>
            <p className="text-muted-foreground">{chosen.title ?? '(chưa có chức danh)'}</p>
          </div>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-[var(--primary)]"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
          />
          Đặt làm người ký mặc định
        </label>
        {isDefault && (
          <p className="text-xs text-muted-foreground">
            Mỗi nghĩa trang chỉ một người mặc định — người đang giữ vai trò này ở {cemeteryName} sẽ
            được bỏ đánh dấu. Nghĩa trang khác không bị ảnh hưởng.
          </p>
        )}

        {blocked !== null && (
          <p className="text-xs text-muted-foreground" aria-live="polite">
            Chưa thêm được: {blocked}
          </p>
        )}
      </div>
    </Dialog>
  );
}

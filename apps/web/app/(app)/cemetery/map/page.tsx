'use client';

import { useMemo, useState } from 'react';
import { Map as MapIcon } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getPlotMap,
  listCemeteries,
  listCompanies,
  listGravePlots,
  setPlotPosition,
  type PlotMapEntry,
} from '@/lib/api';
import { statusOf } from '@/lib/status';
import { PageHeader } from '@/components/ui/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

/* Màu ô mộ theo trạng thái. Dùng biến chủ đề chứ không mã màu tự chế, để sơ đồ đổi theo
 * sáng/tối cùng phần còn lại của hệ. */
const STATUS_FILL: Record<string, string> = {
  Available: 'fill-success/25 stroke-success',
  Held: 'fill-warning/25 stroke-warning',
  Reserved: 'fill-warning/25 stroke-warning',
  Allocated: 'fill-info/25 stroke-info',
  Occupied: 'fill-muted stroke-muted-foreground',
  Maintenance: 'fill-warning/15 stroke-warning',
  Locked: 'fill-destructive/20 stroke-destructive',
};

function errText(e: unknown): string {
  return e instanceof Error ? e.message : 'Có lỗi xảy ra';
}

function PlotMapSvg({
  plots,
  selectedId,
  onSelect,
}: {
  plots: PlotMapEntry[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  /* Khung nhìn ôm vừa dữ liệu, chừa lề. Kẹp sàn bề rộng/cao để một mộ đơn lẻ không bị
   * phóng thành cả trang — chia cho 0 thì SVG hiện trắng, không báo lỗi gì. */
  const box = useMemo(() => {
    if (plots.length === 0) return null;
    const xs = plots.map((p) => p.mapX);
    const ys = plots.map((p) => p.mapY);
    const pad = 4;
    return {
      minX: Math.min(...xs) - pad,
      minY: Math.min(...ys) - pad,
      width: Math.max(Math.max(...xs) - Math.min(...xs) + pad * 2, 12),
      height: Math.max(Math.max(...ys) - Math.min(...ys) + pad * 2, 12),
    };
  }, [plots]);

  if (box === null) {
    return (
      <EmptyState
        icon={MapIcon}
        title="Chưa mộ nào có toạ độ"
        description="Nhập toạ độ ở khung bên phải để mộ hiện lên sơ đồ."
      />
    );
  }

  return (
    <svg
      viewBox={`${box.minX} ${box.minY} ${box.width} ${box.height}`}
      className="h-[28rem] w-full rounded-md border bg-card"
      role="img"
      aria-label="Sơ đồ mặt bằng nghĩa trang"
    >
      {plots.map((p) => (
        <g
          key={p.id}
          className="cursor-pointer"
          onClick={() => onSelect(p.id)}
          role="button"
          aria-label={`Phần mộ ${p.plotCode}`}
        >
          <rect
            x={p.mapX - 1.4}
            y={p.mapY - 1.4}
            width={2.8}
            height={2.8}
            rx={0.3}
            strokeWidth={p.id === selectedId ? 0.5 : 0.2}
            className={`${STATUS_FILL[p.status] ?? 'fill-muted stroke-muted-foreground'} ${
              p.id === selectedId ? 'stroke-primary' : ''
            }`}
          />
          <text
            x={p.mapX}
            y={p.mapY + 3.9}
            textAnchor="middle"
            fontSize={1.5}
            className="fill-muted-foreground"
          >
            {p.plotCode}
          </text>
        </g>
      ))}
    </svg>
  );
}

export default function PlotMapPage() {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState('');
  const [cemeteryId, setCemeteryId] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [pos, setPos] = useState({ x: '', y: '' });

  const companies = useQuery({ queryKey: ['companies'], queryFn: listCompanies });
  const cemeteries = useQuery({
    queryKey: ['cemeteries', companyId],
    queryFn: () => listCemeteries(companyId),
    enabled: companyId !== '',
  });
  const plots = useQuery({
    queryKey: ['gravePlots', companyId],
    queryFn: () => listGravePlots(companyId),
    enabled: companyId !== '',
  });
  const map = useQuery({
    queryKey: ['plotMap', cemeteryId],
    queryFn: () => getPlotMap(cemeteryId),
    enabled: cemeteryId !== '',
  });

  const save = useMutation({
    mutationFn: () =>
      setPlotPosition(
        selectedId,
        pos.x === '' ? null : Number(pos.x),
        pos.y === '' ? null : Number(pos.y),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['plotMap', cemeteryId] });
    },
  });

  const plotsInCemetery = (plots.data ?? []).filter((p) => p.cemeteryId === cemeteryId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sơ đồ mặt bằng"
        description="Toạ độ cục bộ theo từng nghĩa trang, đơn vị mét — đo từ bản vẽ, không phải GPS."
      />

      {save.error !== null && <Alert variant="destructive">{errText(save.error)}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>Chọn nghĩa trang</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Công ty">
              <Select
                value={companyId}
                onChange={(e) => {
                  setCompanyId(e.target.value);
                  setCemeteryId('');
                  setSelectedId('');
                }}
              >
                <option value="">— Chọn công ty —</option>
                {(companies.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Nghĩa trang">
              <Select
                value={cemeteryId}
                onChange={(e) => {
                  setCemeteryId(e.target.value);
                  setSelectedId('');
                }}
                disabled={companyId === ''}
              >
                <option value="">— Chọn nghĩa trang —</option>
                {(cemeteries.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </CardContent>
      </Card>

      {cemeteryId !== '' && (
        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>{map.data?.cemeteryName ?? 'Sơ đồ'}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <PlotMapSvg
                plots={map.data?.plots ?? []}
                selectedId={selectedId}
                onSelect={(id) => {
                  setSelectedId(id);
                  const hit = (map.data?.plots ?? []).find((p) => p.id === id);
                  setPos({ x: String(hit?.mapX ?? ''), y: String(hit?.mapY ?? '') });
                }}
              />

              {/* Nói thẳng phần chưa vẽ được. Sơ đồ thiếu mộ mà im lặng thì người xem
                  tưởng nghĩa trang chỉ có bấy nhiêu ngôi. */}
              {map.data !== undefined && map.data.missingPosition > 0 && (
                <Alert variant="warning">
                  {map.data.missingPosition}/{map.data.totalPlots} phần mộ chưa có toạ độ nên không
                  hiện trên sơ đồ.
                </Alert>
              )}

              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                {['Available', 'Held', 'Allocated', 'Occupied'].map((code) => (
                  <span key={code} className="flex items-center gap-1.5">
                    <span
                      className={`inline-block size-3 rounded-sm border ${STATUS_FILL[code] ?? ''}`}
                    />
                    {statusOf(code).label}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Đặt toạ độ</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="Phần mộ">
                <Select
                  value={selectedId}
                  onChange={(e) => {
                    setSelectedId(e.target.value);
                    const hit = (map.data?.plots ?? []).find((p) => p.id === e.target.value);
                    setPos({ x: String(hit?.mapX ?? ''), y: String(hit?.mapY ?? '') });
                  }}
                >
                  <option value="">— Chọn phần mộ —</option>
                  {plotsInCemetery.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.plotCode}
                    </option>
                  ))}
                </Select>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Toạ độ X (m)">
                  <Input
                    type="number"
                    step="0.1"
                    value={pos.x}
                    onChange={(e) => setPos({ ...pos, x: e.target.value })}
                  />
                </Field>
                <Field label="Toạ độ Y (m)">
                  <Input
                    type="number"
                    step="0.1"
                    value={pos.y}
                    onChange={(e) => setPos({ ...pos, y: e.target.value })}
                  />
                </Field>
              </div>

              <div className="flex gap-2">
                <Button
                  disabled={selectedId === '' || save.isPending}
                  onClick={() => save.mutate()}
                >
                  Lưu toạ độ
                </Button>
                <Button
                  variant="secondary"
                  disabled={selectedId === '' || save.isPending}
                  onClick={() => {
                    setPos({ x: '', y: '' });
                    save.mutate();
                  }}
                  title="Gỡ mộ khỏi sơ đồ, không xoá bản ghi"
                >
                  Gỡ khỏi sơ đồ
                </Button>
              </div>

              {selectedId !== '' && (
                <p className="text-xs text-muted-foreground">
                  Trạng thái:{' '}
                  <Badge
                    variant={
                      statusOf(
                        (map.data?.plots ?? []).find((p) => p.id === selectedId)?.status ?? '',
                      ).variant
                    }
                  >
                    {
                      statusOf(
                        (map.data?.plots ?? []).find((p) => p.id === selectedId)?.status ?? '—',
                      ).label
                    }
                  </Badge>
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

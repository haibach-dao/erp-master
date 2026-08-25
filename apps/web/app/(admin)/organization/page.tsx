import { Building2 } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';

export default function OrganizationPage() {
  return (
    <section className="space-y-6">
      <PageHeader title="Tổ chức" />
      <Card>
        <EmptyState
          icon={Building2}
          title="Chưa dựng cây tổ chức"
          description="Cây tập đoàn / công ty / phòng ban thuộc giai đoạn sau. Phần công ty đang dùng nằm ở các trang nghiệp vụ."
        />
      </Card>
    </section>
  );
}

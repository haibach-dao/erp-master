import { ClipboardCheck } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';

export default function ApprovalInboxPage() {
  return (
    <section className="space-y-6">
      <PageHeader title="Hộp phê duyệt" />
      <Card>
        <EmptyState
          icon={ClipboardCheck}
          title="Chưa có approval engine"
          description="Việc duyệt hiện làm trực tiếp trên từng hồ sơ ở trang Hợp đồng và An táng."
        />
      </Card>
    </section>
  );
}

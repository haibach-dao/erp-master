'use client';

import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';

export function UserMenu() {
  const { user, logout } = useAuth();
  if (user === null) {
    return null;
  }
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{user.email}</span>
      <Button variant="outline" size="sm" onClick={() => void logout()}>
        Đăng xuất
      </Button>
    </div>
  );
}

'use client';

import { LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Dropdown, DropdownItem, DropdownLabel, DropdownSeparator } from '@/components/ui/dropdown';

function initials(email: string): string {
  const name = email.split('@')[0] ?? '';
  const [first, second] = name.split(/[._-]+/).filter((p) => p.length > 0);
  const letters =
    first !== undefined && second !== undefined
      ? `${first.slice(0, 1)}${second.slice(0, 1)}`
      : name.slice(0, 2);
  return letters.toUpperCase();
}

export function UserMenu() {
  const { user, logout } = useAuth();
  if (user === null) {
    return null;
  }

  return (
    <Dropdown
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Tài khoản"
          className="flex size-8 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary transition-colors hover:bg-primary/15"
        >
          {initials(user.email)}
        </button>
      )}
    >
      <DropdownLabel>
        <span className="block truncate font-medium text-foreground">{user.email}</span>
      </DropdownLabel>
      <DropdownSeparator />
      <DropdownItem onClick={() => void logout()}>
        <LogOut aria-hidden />
        Đăng xuất
      </DropdownItem>
    </Dropdown>
  );
}

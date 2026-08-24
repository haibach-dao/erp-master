import { ContextSwitcher } from '@/components/context-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserMenu } from '@/components/user-menu';

export function TopBar() {
  return (
    <header className="flex h-14 items-center justify-between border-b border-border px-4">
      <div className="font-semibold">ERP Master</div>
      <div className="flex items-center gap-3">
        <ContextSwitcher />
        <UserMenu />
        <ThemeToggle />
      </div>
    </header>
  );
}

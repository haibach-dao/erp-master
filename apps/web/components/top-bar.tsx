import { Breadcrumb } from '@/components/breadcrumb';
import { ContextSwitcher } from '@/components/context-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserMenu } from '@/components/user-menu';

export function TopBar() {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-background/80 px-5 backdrop-blur">
      <Breadcrumb />
      <div className="flex items-center gap-2">
        <ContextSwitcher />
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}

'use client';

import { Command } from 'cmdk';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import * as React from 'react';
import { testIds } from '../../testing/testid-registry';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import { usePins } from './sidebar-pins';
import type { LayoutConfig, NavItem, QuickAction } from './types';

const { layout } = testIds;

const itemClassName =
  'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground';

/**
 * Ctrl/⌘+K, or the top-bar Quick actions button. Quick actions first, then pinned pages, then
 * every nav item; each destination appears once. `config` is already ability-filtered.
 */
export function CommandPalette({
  config,
  open,
  onOpenChange,
}: {
  config: LayoutConfig;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('common.quickActions');
  const router = useRouter();
  const locale = useLocale();
  const { pins } = usePins();

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [open, onOpenChange]);

  const quickActions = config.quickActions ?? [];
  const pinned = React.useMemo(() => {
    const byHref = new Map<string, NavItem>();
    for (const group of config.navGroups) {
      for (const item of group.items) byHref.set(item.href, item);
    }
    const taken = new Set(quickActions.flatMap((action) => (action.href ? [action.href] : [])));
    return pins.flatMap((href) => {
      const item = byHref.get(href);
      if (!item || taken.has(href)) return [];
      taken.add(href);
      return [item];
    });
  }, [config.navGroups, quickActions, pins]);

  const navigate = (href: string) => {
    onOpenChange(false);
    router.push(`/${locale}${href}`);
  };

  const run = (action: QuickAction) => {
    onOpenChange(false);
    if (action.onSelect) action.onSelect();
    else if (action.href) router.push(`/${locale}${action.href}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0" data-testid={layout.commandPalette}>
        <DialogTitle className="sr-only">{t('title')}</DialogTitle>
        <DialogDescription className="sr-only">{t('description')}</DialogDescription>
        <Command
          label={t('placeholder')}
          className="[&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:size-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:size-5"
        >
          <Command.Input
            placeholder={t('placeholder')}
            className="flex h-11 w-full rounded-md bg-transparent py-3 px-4 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 border-b"
          />
          <Command.List className="max-h-[300px] overflow-y-auto overflow-x-hidden p-2">
            <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
              {t('empty')}
            </Command.Empty>
            {quickActions.length > 0 && (
              <Command.Group heading={t('heading')}>
                {quickActions.map((action) => {
                  const Icon = action.icon;
                  return (
                    <Command.Item
                      key={action.id}
                      value={`quick-${action.id} ${action.title}`}
                      onSelect={() => run(action)}
                      className={itemClassName}
                      data-testid={layout.quickAction(action.id)}
                    >
                      {Icon && <Icon className="size-4 text-muted-foreground" />}
                      <span>{action.title}</span>
                    </Command.Item>
                  );
                })}
              </Command.Group>
            )}
            {pinned.length > 0 && (
              <Command.Group heading={t('pinned')}>
                {pinned.map((item) => (
                  <PaletteNavItem
                    key={item.href}
                    item={item}
                    value={`pinned-${item.href} ${item.title}`}
                    onSelect={() => navigate(item.href)}
                  />
                ))}
              </Command.Group>
            )}
            {config.navGroups.map((group) => (
              <Command.Group key={group.title} heading={group.title}>
                {group.items.map((item) => (
                  <PaletteNavItem
                    key={item.href}
                    item={item}
                    value={`${item.href} ${item.title}`}
                    onSelect={() => navigate(item.href)}
                  />
                ))}
              </Command.Group>
            ))}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function PaletteNavItem({
  item,
  value,
  onSelect,
}: {
  item: NavItem;
  value: string;
  onSelect: () => void;
}) {
  const Icon = item.icon;
  return (
    <Command.Item value={value} onSelect={onSelect} className={itemClassName}>
      {Icon && <Icon className="size-4 text-muted-foreground" />}
      <span>{item.title}</span>
    </Command.Item>
  );
}

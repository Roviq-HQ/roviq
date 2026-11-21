'use client';

import { Check, Languages } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { testIds } from '../../testing/testid-registry';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

const { layout } = testIds;

const locales = [
  { value: 'en', label: 'English', flag: '🇬🇧' },
  { value: 'hi', label: 'हिन्दी', flag: '🇮🇳' },
];

export function LocaleSwitcher({ onLocaleChange }: { onLocaleChange: (locale: string) => void }) {
  const locale = useLocale();
  const t = useTranslations('locale');

  const current = locales.find((l) => l.value === locale);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          title={t('switchLocale')}
          variant="ghost"
          size="icon"
          className="relative"
          data-testid={layout.localeSwitcher}
        >
          <Languages className="size-4" />
          <span className="absolute -right-0.5 -bottom-0.5 text-[10px] leading-none">
            {current?.flag}
          </span>
          <span className="sr-only">{t('switchLocale')}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {t('switchLocale')}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {locales.map((l) => (
          <DropdownMenuItem
            key={l.value}
            onClick={() => onLocaleChange(l.value)}
            className="flex items-center justify-between"
            data-testid={layout.localeOption(l.value)}
          >
            <span className="flex items-center gap-2">
              <span>{l.flag}</span>
              <span>{l.label}</span>
            </span>
            {locale === l.value && <Check className="size-3.5 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

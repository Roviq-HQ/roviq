'use client';

import { useI18nField } from '@roviq/i18n';
import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  useDebounce,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { Loader2, UserSearch } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { useUserSearch } from './use-users';

const { adminUsers } = testIds;

/** Quick-jump to a user's detail page; independent of the table filters below it. */
export function UserJumpSearch() {
  const t = useTranslations('adminUsers.jump');
  const router = useRouter();
  const resolveI18n = useI18nField();
  const [open, setOpen] = React.useState(false);
  const [input, setInput] = React.useState('');
  const query = useDebounce(input, 200);
  const { data, loading } = useUserSearch(query);
  const results = query.trim().length >= 2 ? (data?.adminSearchUsers ?? []) : [];

  const select = (id: string) => {
    setOpen(false);
    setInput('');
    router.push(`/admin/users/${id}`);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-start gap-2 font-normal text-muted-foreground sm:w-72"
          data-testid={adminUsers.jumpTrigger}
        >
          <UserSearch className="size-4" />
          {t('trigger')}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-72 p-0" align="end">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={t('placeholder')}
            value={input}
            onValueChange={setInput}
            data-testid={adminUsers.jumpInput}
          />
          <CommandList>
            <CommandEmpty>
              {query.trim().length < 2 ? (
                t('minChars')
              ) : loading ? (
                <Loader2 className="mx-auto size-4 animate-spin" aria-label={t('loading')} />
              ) : (
                t('noResults')
              )}
            </CommandEmpty>
            {results.length > 0 && (
              <CommandGroup>
                {results.map((user) => {
                  const name = user.profile
                    ? [resolveI18n(user.profile.firstName), resolveI18n(user.profile.lastName)]
                        .filter(Boolean)
                        .join(' ')
                    : '';
                  return (
                    <CommandItem
                      key={user.id}
                      value={user.id}
                      onSelect={() => select(user.id)}
                      data-testid={adminUsers.jumpResult(user.id)}
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">{name || user.username}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {user.username} · {user.email}
                        </span>
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

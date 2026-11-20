'use client';

import { useAuth } from '@roviq/auth';
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
import { Check, ChevronsUpDown, User } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { useStudents } from '../people/students/use-students';
import { useMayApplyFor } from './leave-abilities';
import { useOwnName } from './use-own-name';

export interface ApplicantPickerTestIds {
  trigger: string;
  input: string;
  option: (membershipId: string) => string;
  clear?: string;
}

interface ApplicantPickerProps {
  /** A membership id — leaves belong to memberships, not to student profiles. */
  value: string | null;
  onChange: (membershipId: string | null) => void;
  /** Adds a "clear" entry, for filters. */
  clearable?: boolean;
  /** Lists only the people the caller may file a leave for, e.g. a guardian's children. */
  onlyApplicable?: boolean;
  /** Offers the signed-in person first, so someone who files for others can return to themself. */
  includeSelf?: boolean;
  id?: string;
  testIds: ApplicantPickerTestIds;
}

/**
 * Backed by the student list because there is no shared membership lookup yet,
 * so staff other than the signed-in person do not resolve to a name.
 */
export function ApplicantPicker({
  value,
  onChange,
  clearable,
  onlyApplicable,
  includeSelf,
  id,
  testIds,
}: ApplicantPickerProps) {
  const t = useTranslations('leave');
  const resolveI18n = useI18nField();
  const { user } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [picked, setPicked] = React.useState<{ membershipId: string; label: string } | null>(null);
  const debouncedSearch = useDebounce(search, 250);

  const { students } = useStudents({ first: 50, search: debouncedSearch || undefined });
  const mayApplyFor = useMayApplyFor();
  const options = React.useMemo(
    () =>
      students.flatMap((stu) => {
        if (!stu.membershipId) return [];
        if (onlyApplicable && !mayApplyFor({ id: stu.id, membershipId: stu.membershipId })) {
          return [];
        }
        const name = [resolveI18n(stu.firstName), resolveI18n(stu.lastName)]
          .filter(Boolean)
          .join(' ');
        return [{ membershipId: stu.membershipId, label: `${name} · ${stu.admissionNumber}` }];
      }),
    [students, resolveI18n, onlyApplicable, mayApplyFor],
  );

  const ownMembershipId = user?.membershipId ?? null;
  const isSelf = value != null && value === ownMembershipId;
  const ownName = useOwnName(!isSelf && !includeSelf);
  const selfOption =
    includeSelf && ownMembershipId
      ? { membershipId: ownMembershipId, label: ownName ?? t('picker.self') }
      : null;

  const selectedLabel = React.useMemo(() => {
    if (!value) return null;
    if (selfOption && value === selfOption.membershipId) return selfOption.label;
    const option = options.find((o) => o.membershipId === value);
    if (option) return option.label;
    if (isSelf && ownName) return ownName;
    // The search may have narrowed the list past the chosen person.
    if (picked?.membershipId === value) return picked.label;
    return t('picker.selected');
  }, [value, options, isSelf, ownName, picked, selfOption, t]);

  function select(next: { membershipId: string; label: string } | null) {
    setPicked(next);
    onChange(next?.membershipId ?? null);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          data-testid={testIds.trigger}
        >
          <span className="truncate">{selectedLabel ?? t('picker.placeholder')}</span>
          <ChevronsUpDown className="ms-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={t('picker.search')}
            value={search}
            onValueChange={setSearch}
            data-testid={testIds.input}
          />
          <CommandList>
            <CommandEmpty>
              <span className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
                <User className="size-4" aria-hidden="true" />
                {onlyApplicable && !search ? t('picker.noChildren') : t('picker.noResults')}
              </span>
            </CommandEmpty>
            <CommandGroup>
              {clearable && value ? (
                <CommandItem
                  value="__clear__"
                  onSelect={() => select(null)}
                  data-testid={testIds.clear}
                >
                  <Check className="me-2 size-4 opacity-0" />
                  {t('picker.clear')}
                </CommandItem>
              ) : null}
              {selfOption && !search ? (
                <CommandItem
                  value={selfOption.membershipId}
                  onSelect={() => select(selfOption)}
                  data-testid={testIds.option(selfOption.membershipId)}
                >
                  <Check
                    className={`me-2 size-4 ${value === selfOption.membershipId ? 'opacity-100' : 'opacity-0'}`}
                  />
                  {selfOption.label}
                </CommandItem>
              ) : null}
              {options
                .filter((option) => option.membershipId !== selfOption?.membershipId)
                .map((option) => (
                  <CommandItem
                    key={option.membershipId}
                    value={option.membershipId}
                    onSelect={() => select(option)}
                    data-testid={testIds.option(option.membershipId)}
                  >
                    <Check
                      className={`me-2 size-4 ${value === option.membershipId ? 'opacity-100' : 'opacity-0'}`}
                    />
                    {option.label}
                  </CommandItem>
                ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

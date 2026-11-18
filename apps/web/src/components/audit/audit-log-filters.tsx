'use client';

import { type I18nText, useFormatDate, useI18nField } from '@roviq/i18n';
import {
  Button,
  Calendar,
  DataTableToolbar,
  Input,
  MultiSelect,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { CalendarIcon, Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useQueryStates } from 'nuqs';
import * as React from 'react';
import {
  ACTION_TYPES,
  type AuditScope,
  auditFilterParsers,
  CLEARED_AUDIT_FILTERS,
  ENTITY_TYPES,
  hasActiveAuditFilters,
  UUID_REGEX,
} from './audit-utils';

const { auditLogs } = testIds;

export interface AuditLogFiltersProps {
  scope: AuditScope;
  /** When given, adds an institute dropdown (portals that see more than one institute). */
  institutes?: readonly { id: string; name: I18nText }[];
}

export function useAuditLogFilters() {
  return useQueryStates(auditFilterParsers);
}

export function AuditLogFilters({ scope, institutes }: AuditLogFiltersProps) {
  const t = useTranslations('auditLogs');
  const resolveI18n = useI18nField();
  const { format: formatDate } = useFormatDate();
  const [filters, setFilters] = useAuditLogFilters();

  const dateFrom = filters.dateFrom ? new Date(filters.dateFrom) : undefined;
  const dateTo = filters.dateTo ? new Date(filters.dateTo) : undefined;

  const [entityIdInput, setEntityIdInput] = React.useState(filters.entityId ?? '');
  const [entityIdError, setEntityIdError] = React.useState<string | null>(null);

  const handleEntityIdSearch = () => {
    const value = entityIdInput.trim();
    if (!value) {
      setFilters({ entityId: null });
      setEntityIdError(null);
      return;
    }
    if (!UUID_REGEX.test(value)) {
      setEntityIdError(t('search.invalidId'));
      return;
    }
    setEntityIdError(null);
    setFilters({ entityId: value });
  };

  const clearEntityId = () => {
    setEntityIdInput('');
    setEntityIdError(null);
    setFilters({ entityId: null });
  };

  return (
    <DataTableToolbar>
      <div className="flex items-center gap-1.5">
        <div className="relative">
          <Input
            placeholder={t('search.placeholder')}
            aria-label={t('search.placeholder')}
            value={entityIdInput}
            onChange={(e) => {
              setEntityIdInput(e.target.value);
              if (entityIdError) setEntityIdError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleEntityIdSearch();
            }}
            className={`w-[280px] font-mono text-xs ${entityIdError ? 'border-destructive' : ''}`}
            data-testid={auditLogs.entityIdSearch}
          />
          {entityIdError && (
            <span className="absolute -bottom-5 start-0 text-[11px] text-destructive">
              {entityIdError}
            </span>
          )}
        </div>
        <Button
          variant="outline"
          size="icon"
          aria-label={t('search.button')}
          title={t('search.button')}
          onClick={handleEntityIdSearch}
        >
          <Search className="size-4" />
        </Button>
        {filters.entityId && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('search.clear')}
            title={t('search.clear')}
            onClick={clearEntityId}
          >
            <X className="size-4" />
          </Button>
        )}
      </div>

      <ClearableSelect
        value={filters.entityType}
        onChange={(entityType) => setFilters({ entityType })}
        placeholder={t('filters.entityType')}
        clearLabel={t('filters.clearEntityType')}
        className="w-[160px]"
        options={ENTITY_TYPES[scope].map((type) => ({ value: type, label: type }))}
      />

      <MultiSelect
        value={filters.actionType ?? []}
        onChange={(next) => setFilters({ actionType: next.length > 0 ? next : null })}
        options={ACTION_TYPES.map((type) => ({ value: type, label: t(`actionTypes.${type}`) }))}
        placeholder={t('filters.actionType')}
        selectedLabel={(count) => t('filters.actionTypesSelected', { count })}
        clearLabel={t('filters.clearSelection')}
        className="w-[170px]"
        data-testid={auditLogs.actionTypeFilter}
        optionTestId={auditLogs.actionTypeOption}
      />

      <Input
        placeholder={t('filters.userId')}
        aria-label={t('filters.userId')}
        value={filters.userId ?? ''}
        onChange={(e) => setFilters({ userId: e.target.value || null })}
        className="w-[200px]"
      />

      {institutes && (
        <ClearableSelect
          value={filters.tenantId}
          onChange={(tenantId) => setFilters({ tenantId })}
          placeholder={t('filters.institute')}
          clearLabel={t('filters.clearInstitute')}
          className="w-[200px]"
          triggerTestId={auditLogs.instituteFilter}
          clearTestId={auditLogs.instituteFilterClear}
          options={institutes.map((inst) => ({ value: inst.id, label: resolveI18n(inst.name) }))}
        />
      )}

      <DateFilter
        label={t('filters.dateFrom')}
        value={dateFrom}
        display={dateFrom ? formatDate(dateFrom, 'dd/MM/yyyy') : null}
        onChange={(date) => setFilters({ dateFrom: date ? date.toISOString() : null })}
      />
      <DateFilter
        label={t('filters.dateTo')}
        value={dateTo}
        display={dateTo ? formatDate(dateTo, 'dd/MM/yyyy') : null}
        onChange={(date) => setFilters({ dateTo: date ? date.toISOString() : null })}
      />

      {hasActiveAuditFilters(filters) && (
        <Button
          variant="ghost"
          size="sm"
          data-testid={auditLogs.clearFilters}
          onClick={() => {
            setEntityIdInput('');
            setEntityIdError(null);
            setFilters(CLEARED_AUDIT_FILTERS);
          }}
        >
          <X className="me-1 size-4" />
          {t('filters.clearFilters')}
        </Button>
      )}
    </DataTableToolbar>
  );
}

function ClearableSelect({
  value,
  onChange,
  options,
  placeholder,
  clearLabel,
  className,
  triggerTestId,
  clearTestId,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  options: { value: string; label: string }[];
  placeholder: string;
  clearLabel: string;
  className: string;
  triggerTestId?: string;
  clearTestId?: string;
}) {
  return (
    <div className="relative">
      <Select value={value ?? ''} onValueChange={(next) => onChange(next || null)}>
        <SelectTrigger className={className} aria-label={placeholder} data-testid={triggerTestId}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={clearLabel}
          title={clearLabel}
          className="absolute end-7 top-1/2 size-5 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          data-testid={clearTestId}
          onClick={() => onChange(null)}
        >
          <X className="size-3" />
        </Button>
      )}
    </div>
  );
}

function DateFilter({
  label,
  value,
  display,
  onChange,
}: {
  label: string;
  value: Date | undefined;
  display: string | null;
  onChange: (date: Date | undefined) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          aria-label={label}
          className="w-[140px] justify-start text-start font-normal"
        >
          <CalendarIcon className="me-2 size-4" />
          {display ?? label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="single" selected={value} onSelect={onChange} />
      </PopoverContent>
    </Popover>
  );
}

'use client';

import { cn } from '@roviq/ui/lib/utils';
import { ChevronDown } from 'lucide-react';
import { Button } from './button';
import { Checkbox } from './checkbox';
import { Label } from './label';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

export interface MultiSelectOption {
  value: string;
  label: string;
}

export interface MultiSelectProps {
  options: MultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  /** Trigger text when nothing is selected; also the trigger's accessible name. */
  placeholder: string;
  /** Trigger text when two or more options are selected, e.g. "3 selected". */
  selectedLabel: (count: number) => string;
  clearLabel: string;
  className?: string;
  'data-testid'?: string;
  optionTestId?: (value: string) => string;
}

export function MultiSelect({
  options,
  value,
  onChange,
  placeholder,
  selectedLabel,
  clearLabel,
  className,
  'data-testid': dataTestId,
  optionTestId,
}: MultiSelectProps) {
  const toggle = (optionValue: string) => {
    onChange(
      value.includes(optionValue)
        ? value.filter((v) => v !== optionValue)
        : // Keep the options' own order so the URL and the query stay stable.
          options.map((o) => o.value).filter((v) => v === optionValue || value.includes(v)),
    );
  };

  const triggerText =
    value.length === 0
      ? placeholder
      : value.length === 1
        ? (options.find((o) => o.value === value[0])?.label ?? value[0])
        : selectedLabel(value.length);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-label={placeholder}
          className={cn('justify-between font-normal', className)}
          data-testid={dataTestId}
        >
          <span className={cn('truncate', value.length === 0 && 'text-muted-foreground')}>
            {triggerText}
          </span>
          <ChevronDown className="size-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        <div className="space-y-0.5">
          {options.map((option) => (
            <Label
              key={option.value}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm font-normal hover:bg-accent"
            >
              <Checkbox
                checked={value.includes(option.value)}
                onCheckedChange={() => toggle(option.value)}
                data-testid={optionTestId?.(option.value)}
              />
              {option.label}
            </Label>
          ))}
        </div>
        {value.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-1 w-full"
            onClick={() => onChange([])}
          >
            {clearLabel}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

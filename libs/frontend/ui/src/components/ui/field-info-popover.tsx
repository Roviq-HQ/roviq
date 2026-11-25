import { Popover, PopoverContent, PopoverTrigger } from '@roviq/ui/components/ui/popover';
import { cn } from '@roviq/ui/lib/utils';
import { Info } from 'lucide-react';
import * as React from 'react';

type FieldInfoPopoverProps = {
  title: string;
  children: React.ReactNode;
  side?: React.ComponentProps<typeof PopoverContent>['side'];
  align?: React.ComponentProps<typeof PopoverContent>['align'];
  iconClassName?: string;
  contentClassName?: string;
  /** Translated accessible name of the trigger. */
  triggerLabel?: string;
  /** Controlled open state; omit to let the popover manage it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Lets a caller return focus to the trigger after a sheet it opened closes. */
  triggerRef?: React.Ref<HTMLButtonElement>;
  'data-testid'?: string;
};

/** Standard hover-open delay — feels intentional without being slow. */
const HOVER_OPEN_DELAY_MS = 250;
/**
 * Generous close delay so the cursor has time to cross the icon-to-popover
 * gap without the body flickering shut. Any mouseenter on the popover body
 * cancels this timer, so the popover stays open as long as the cursor is
 * anywhere inside the trigger+content region.
 */
const HOVER_CLOSE_DELAY_MS = 300;

/**
 * Contextual field-help affordance. Opens on hover after a short delay, or on
 * click, tap or keyboard. Opened by click or keyboard it stays open until
 * Escape or an outside click, so the reader can move the cursor away.
 */
function FieldInfoPopover({
  title,
  children,
  side = 'top',
  align = 'start',
  iconClassName,
  contentClassName,
  triggerLabel = 'More info',
  open: controlledOpen,
  onOpenChange,
  triggerRef,
  'data-testid': testId,
}: FieldInfoPopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const pinnedRef = React.useRef(false);
  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!next) pinnedRef.current = false;
      setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelTimer = React.useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const scheduleOpen = React.useCallback(() => {
    cancelTimer();
    timerRef.current = setTimeout(() => setOpen(true), HOVER_OPEN_DELAY_MS);
  }, [cancelTimer, setOpen]);

  const scheduleClose = React.useCallback(() => {
    if (pinnedRef.current) return;
    cancelTimer();
    timerRef.current = setTimeout(() => setOpen(false), HOVER_CLOSE_DELAY_MS);
  }, [cancelTimer, setOpen]);

  React.useEffect(() => cancelTimer, [cancelTimer]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        cancelTimer();
        pinnedRef.current = next;
        setOpen(next);
      }}
    >
      <PopoverTrigger
        ref={triggerRef}
        type="button"
        aria-label={triggerLabel}
        data-testid={testId ?? 'field-info-trigger'}
        data-slot="field-info-trigger"
        onMouseEnter={() => {
          if (!open) scheduleOpen();
        }}
        onMouseLeave={scheduleClose}
        onClick={(e) => {
          // Hover already opened it: a click keeps it open instead of toggling it shut.
          if (open && !pinnedRef.current) {
            e.preventDefault();
            cancelTimer();
            pinnedRef.current = true;
          }
        }}
        className={cn(
          'relative inline-flex size-4 shrink-0 cursor-help items-center justify-center rounded-full',
          // A 40px tap area around the 16px icon.
          "after:absolute after:-inset-3 after:content-['']",
          'text-muted-foreground/70 transition-colors',
          'hover:text-foreground focus-visible:text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1',
        )}
      >
        <Info className={cn('size-3.5', iconClassName)} strokeWidth={2} aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={2}
        // The 16px page gutter on phones: Radix otherwise lets the panel touch the screen edge.
        collisionPadding={16}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onMouseEnter={cancelTimer}
        onMouseLeave={scheduleClose}
        className={cn(
          'w-96 max-w-[calc(100vw-2rem)] rounded-lg border border-border/60 p-0 text-sm shadow-lg',
          contentClassName,
        )}
        data-slot="field-info-content"
      >
        <div className="flex items-start gap-2.5 border-b border-border/60 px-3.5 py-2.5">
          <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <p className="font-medium leading-snug text-foreground">{title}</p>
        </div>
        <div
          className={cn(
            'px-3.5 py-2.5 text-[13px] leading-relaxed text-muted-foreground',
            '[&>p]:m-0 [&>p+p]:mt-2',
            '[&>ul]:m-0 [&>ul]:mt-1.5 [&>ul]:space-y-1 [&>ul]:ps-4',
            '[&>ol]:m-0 [&>ol]:mt-1.5 [&>ol]:space-y-1 [&>ol]:ps-4',
            '[&_em]:not-italic [&_em]:text-foreground/80',
          )}
        >
          {children}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export { FieldInfoPopover, type FieldInfoPopoverProps };

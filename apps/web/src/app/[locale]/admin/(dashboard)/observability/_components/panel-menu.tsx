'use client';

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@roviq/ui';
import { Copy, ExternalLink, MoreVertical } from 'lucide-react';
import { toast } from 'sonner';
import {
  type OpenObserveSection,
  openObserveMetricsUrl,
  openObserveSectionUrl,
} from '../_lib/openobserve-links';

type PanelMenuProps =
  | { promQuery: string; openObserveUrl: string }
  | { section: Exclude<OpenObserveSection, 'metrics'>; openObserveUrl: string };

export function PanelMenu(props: PanelMenuProps) {
  const promQuery = 'promQuery' in props ? props.promQuery : undefined;
  const exploreUrl =
    'promQuery' in props
      ? openObserveMetricsUrl(props.openObserveUrl, props.promQuery)
      : openObserveSectionUrl(props.openObserveUrl, props.section);

  const handleCopy = async () => {
    if (promQuery === undefined) return;
    try {
      await navigator.clipboard.writeText(promQuery);
      toast.success('Copied');
    } catch {
      toast.error('Copy failed');
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label="Panel menu">
          <MoreVertical className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <a href={exploreUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="mr-2 size-4" />
            Open in OpenObserve
          </a>
        </DropdownMenuItem>
        {promQuery !== undefined ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleCopy}>
              <Copy className="mr-2 size-4" />
              Copy PromQL
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

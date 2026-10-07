import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type PointerEvent, type ReactNode } from 'react';
import { Link2, Grip, AlertCircle } from 'lucide-react';
import { Skeleton } from '@moodboard/ui';
import type { ItemResponse } from '@moodboard/contracts';
import { api } from '../../lib/api';

/** Shared presentation for real board items and the labeled landing example. */
export function ItemCardView({
  title,
  note,
  imageUrl,
  imageSrcSet,
  imageSizes,
  mediaState,
  link,
  selected = false,
  onSelect,
  onMediaError,
  action,
  price,
  priority = false,
  footer,
}: {
  title: string;
  note?: string | null;
  imageUrl?: string;
  imageSrcSet?: string;
  imageSizes?: string;
  mediaState?: 'pending' | 'failed';
  link?: { url: string; label: string };
  selected?: boolean;
  onSelect?: () => void;
  onMediaError?: () => void;
  action?: ReactNode;
  price?: string;
  priority?: boolean;
  footer?: ReactNode;
}) {
  return (
    <article
      onClick={onSelect}
      className={`item-card ${selected ? 'is-selected' : ''} ${onSelect ? 'cursor-pointer' : ''}`}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          srcSet={imageSrcSet}
          sizes={imageSizes}
          alt={title}
          width={600}
          height={450}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          className="max-h-80 w-full object-cover"
          onError={onMediaError}
        />
      ) : mediaState === 'pending' ? (
        <div role="status" className="bg-cream p-4">
          <Skeleton className="h-40" />
          <span className="mt-3 block text-xs text-muted">Preparing image…</span>
        </div>
      ) : mediaState === 'failed' ? (
        <div className="flex min-h-36 items-center justify-center gap-2 bg-cream p-5 text-sm text-muted">
          <AlertCircle size={18} /> Image unavailable
        </div>
      ) : link ? (
        <div className="flex min-h-24 items-center justify-center bg-cream">
          <Link2 size={24} className="text-muted" />
        </div>
      ) : null}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            {onSelect ? (
              <button
                type="button"
                className="w-full break-words text-left text-sm font-semibold"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect();
                }}
              >
                {title}
              </button>
            ) : (
              <p className="break-words text-sm font-semibold">{title}</p>
            )}
            {link && (
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="mt-1 block truncate text-xs text-accent hover:underline"
              >
                {link.label}
              </a>
            )}
          </div>
          {action}
        </div>
        {note && (
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted">
            {note}
          </p>
        )}
        {price && <p className="mt-3 text-sm font-semibold tabular-nums">{price}</p>}
      </div>
      {footer && <div className="border-t border-line p-4">{footer}</div>}
    </article>
  );
}

export function ItemCard({
  item,
  client = false,
  selected = false,
  onSelect,
  onDrag,
  onKeyMove,
  footer,
}: {
  item: ItemResponse;
  client?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  onDrag?: (event: PointerEvent<HTMLButtonElement>) => void;
  onKeyMove?: (dx: number, dy: number) => void;
  footer?: ReactNode;
}) {
  const [broken, setBroken] = useState(false);
  const media = useQuery({
    queryKey: [
      client ? 'client' : 'account',
      'asset',
      item.kind === 'image' ? item.asset.id : 'none',
    ],
    queryFn: () =>
      item.kind === 'image' ? api.assetUrl(item.asset.id, 'thumbnail', client) : Promise.reject(),
    enabled: item.kind === 'image' && item.asset.status === 'ready',
    staleTime: 240000,
    refetchInterval: item.kind === 'image' && item.asset.status === 'ready' ? 240000 : false,
    retry: 1,
  });
  const imageUrl =
    item.kind === 'image'
      ? media.data?.url
      : item.kind === 'link'
        ? (item.preview.imageUrl ?? undefined)
        : undefined;
  useEffect(() => {
    setBroken(false);
  }, [imageUrl]);
  const mediaState =
    item.kind === 'image'
      ? broken || media.isError || item.asset.status === 'failed'
        ? 'failed'
        : imageUrl
          ? undefined
          : 'pending'
      : undefined;
  return (
    <ItemCardView
      footer={footer}
      title={
        item.title ||
        (item.kind === 'link'
          ? item.preview.title || 'Saved link'
          : item.kind === 'image'
            ? 'Image'
            : 'Untitled note')
      }
      note={item.note}
      imageUrl={broken ? undefined : imageUrl}
      mediaState={mediaState}
      link={
        item.kind === 'link'
          ? {
              url: item.preview.url,
              label: item.preview.siteName || new URL(item.preview.url).hostname,
            }
          : undefined
      }
      selected={selected}
      onSelect={onSelect}
      onMediaError={() => {
        setBroken(true);
        if (item.kind === 'image') {
          void media.refetch();
        }
      }}
      price={
        item.priceCents !== undefined && item.priceCents !== null
          ? (item.priceCents / 100).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })
          : undefined
      }
      action={
        onDrag && (
          <button
            type="button"
            aria-label="Move item; use arrow keys for keyboard movement"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={onDrag}
            onKeyDown={(e) => {
              if (!onKeyMove || !e.key.startsWith('Arrow')) {
                return;
              }
              e.preventDefault();
              const step = e.shiftKey ? 20 : 10;
              onKeyMove(
                e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0,
                e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0,
              );
            }}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted hover:bg-cream"
          >
            <Grip size={17} />
          </button>
        )
      }
    />
  );
}

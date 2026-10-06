import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Image, LayoutGrid } from 'lucide-react';
import { Skeleton } from '@moodboard/ui';
import type { ItemResponse } from '@moodboard/contracts';
import { api, items as fetchItems } from '../../lib/api';

export function BoardPreview({ boardId }: { boardId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '100px' },
    );
    if (ref.current) {
      observer.observe(ref.current);
    }
    return () => observer.disconnect();
  }, []);
  const items = useQuery({
    queryKey: ['account', 'board', boardId, 'items'],
    queryFn: () => fetchItems(boardId),
    enabled: visible,
    staleTime: 60000,
    retry: 1,
  });
  const images = (items.data ?? [])
    .filter(
      (item) =>
        !item.deletedAt &&
        ((item.kind === 'image' && item.asset.status === 'ready') ||
          (item.kind === 'link' && item.preview.imageUrl)),
    )
    .slice(0, 3);
  return (
    <div ref={ref} className="aspect-[4/3] overflow-hidden rounded-xl bg-cream">
      {!visible || items.isPending ? (
        <Skeleton className="h-full w-full" />
      ) : images.length ? (
        <div
          className={`grid h-full gap-1 ${images.length > 1 ? 'grid-cols-[1.3fr_1fr]' : 'grid-cols-1'}`}
        >
          {images.map((item, index) => (
            <PreviewImage key={item.id} item={item} tall={index === 0 && images.length === 3} />
          ))}
        </div>
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-muted">
          <LayoutGrid size={30} strokeWidth={1.5} />
          <span className="text-xs">
            {items.isError ? 'Preview unavailable' : 'Space for your ideas'}
          </span>
        </div>
      )}
    </div>
  );
}
function PreviewImage({ item, tall }: { item: ItemResponse; tall: boolean }) {
  const [broken, setBroken] = useState(false);
  const media = useQuery({
    queryKey: ['account', 'asset', item.kind === 'image' ? item.asset.id : 'none'],
    queryFn: () =>
      item.kind === 'image' ? api.assetUrl(item.asset.id, 'thumbnail') : Promise.reject(),
    enabled: item.kind === 'image',
    staleTime: 240000,
    retry: 1,
  });
  const url =
    item.kind === 'image' ? media.data?.url : item.kind === 'link' ? item.preview.imageUrl : null;
  return (
    <div className={`min-h-0 overflow-hidden ${tall ? 'row-span-2' : ''}`}>
      {url && !broken ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        <div className="flex h-full items-center justify-center">
          <Image size={24} strokeWidth={1.5} className="text-muted" />
        </div>
      )}
    </div>
  );
}

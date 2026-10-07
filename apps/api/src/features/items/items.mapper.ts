import { BoardRole, ItemResponse, NoteResponse } from '@moodboard/contracts';
import { AssetEntity, ItemEntity, LinkPreviewEntity } from '@moodboard/database';
import { roleRank } from '../access/board-role';

export function noteResponse(
  item: ItemEntity,
  role: BoardRole,
  showPricesTo: BoardRole,
): NoteResponse {
  return {
    id: item.id,
    boardId: item.boardId,
    sectionId: item.sectionId,
    createdBy: item.createdBy,
    kind: 'note',
    title: item.title,
    note: item.note,
    x: item.x,
    y: item.y,
    zOrder: item.zOrder,
    ...(roleRank[role] >= roleRank[showPricesTo] ? { priceCents: item.priceCents } : {}),
    quantity: item.quantity,
    version: item.version,
    deletedAt: item.deletedAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export function itemResponses(
  items: ItemEntity[],
  assets: AssetEntity[],
  previews: LinkPreviewEntity[],
  role: BoardRole,
  showPricesTo: BoardRole,
): ItemResponse[] {
  const assetsById = new Map(assets.map((asset) => [`${asset.boardId}:${asset.id}`, asset]));
  const previewsById = new Map(previews.map((preview) => [preview.id, preview]));
  return items.map((item): ItemResponse => {
    const base = noteResponse(item, role, showPricesTo);
    if (item.kind === 'note') {
      return base;
    }
    if (item.kind === 'image') {
      const asset = assetsById.get(`${item.boardId}:${item.assetId}`);
      if (!asset) {
        throw new Error('Item asset missing');
      }
      return {
        ...base,
        kind: 'image',
        asset: {
          id: asset.id,
          status: asset.status,
          mime: asset.mimeType,
          bytes: asset.bytes,
          width: asset.width,
          height: asset.height,
          palette: asset.palette,
        },
      };
    }
    const preview = previewsById.get(item.linkPreviewId!);
    if (!preview) {
      throw new Error('Item preview missing');
    }
    return {
      ...base,
      kind: 'link',
      preview: {
        id: preview.id,
        url: preview.url,
        status: preview.status,
        title: preview.title,
        description: preview.description,
        imageUrl: preview.imageUrl,
        siteName: preview.siteName,
        fetchedAt: preview.fetchedAt?.toISOString() ?? null,
        expiresAt: preview.expiresAt?.toISOString() ?? null,
      },
    };
  });
}

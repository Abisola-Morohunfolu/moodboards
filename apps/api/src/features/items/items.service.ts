import { createHash } from 'node:crypto';
import { resourceLock } from '@moodboard/database';
import { AssetsService } from '../assets/assets.service';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  CreateItemRequest,
  MoveNoteRequest,
  UpdateNoteRequest,
  PageQuery,
  RestoreItemRequest,
} from '@moodboard/contracts';
import { AccessService } from '../access/access.service';
import { SectionsRepository } from '../sections/sections.repository';
import { BoardEventWriter } from '../../platform/events/board-event.writer';
import { ItemsRepository } from './items.repository';
import { ItemPreviewsRepository } from './item-previews.repository';
import { BoardPrincipal } from '../access/contact-access';
import { ApprovalsService } from '../approvals/approvals.service';
import { decodeCursor, encodeCursor } from '../../platform/pagination';

@Injectable()
export class ItemsService {
  constructor(
    private readonly access: AccessService,
    private readonly repository: ItemsRepository,
    private readonly sections: SectionsRepository,
    private readonly events: BoardEventWriter,
    private readonly previews: ItemPreviewsRepository,
    @Optional() private readonly assets?: AssetsService,
    @Optional() private readonly approvals?: ApprovalsService,
  ) {}
  list(userId: BoardPrincipal, boardId: string) {
    return this.access.withBoard(
      userId,
      boardId,
      'board.view',
      async (manager, access) => {
        const items = await this.repository.list(manager, boardId);
        return this.repository.responses(manager, items, access.role, access.board.showPricesTo);
      },
      false,
    );
  }
  async trash(userId: string, boardId: string, input: PageQuery) {
    const scope = `trash:${boardId.toLowerCase()}`;
    const cursor = decodeCursor(input.cursor, scope);
    if (cursor && cursor.type !== 'item') {
      throw new BadRequestException('Invalid trash cursor');
    }
    return this.access.withBoard(
      userId,
      boardId,
      'item.delete',
      async (manager, access) => {
        const page = await this.repository.trash(manager, boardId, cursor);
        return {
          items: await this.repository.responses(
            manager,
            page.items,
            access.role,
            access.board.showPricesTo,
          ),
          nextCursor: page.hasMore
            ? encodeCursor({ scope, type: 'item', time: page.time!, id: page.items.at(-1)!.id })
            : null,
        };
      },
      false,
    );
  }
  async restore(userId: string, itemId: string, input: RestoreItemRequest) {
    const boardId = await this.repository.boardId(itemId);
    return this.access.withBoard(
      userId,
      boardId,
      'item.delete',
      async (manager, access) => {
        const current = await this.repository.get(manager, boardId, itemId);
        if (current.deletedAt === null) {
          return this.repository.response(manager, current, access.role, access.board.showPricesTo);
        }
        if (current.deletedAt.getTime() !== new Date(input.deletedAt).getTime()) {
          throw new ConflictException(
            'This item was deleted again. Refresh trash before restoring.',
          );
        }
        const item = await this.repository.restore(manager, boardId, itemId);
        await this.events.append(manager, boardId, access.participantId!, {
          type: 'item.restored',
          payload: {
            itemId,
            kind: item.kind,
            version: item.version,
            ...(item.assetId ? { assetId: item.assetId } : {}),
            ...(item.linkPreviewId ? { previewId: item.linkPreviewId } : {}),
          },
        });
        if (access.board.workspaceType === 'business' && access.board.clientId !== null) {
          await this.approvals?.reconcileBoard(manager, boardId, access.participantId);
        }
        return this.repository.response(manager, item, access.role, access.board.showPricesTo);
      },
      true,
      async (manager) => {
        // Preview completion uses the same resource-before-board lock order as creation.
        const lock = await this.repository.previewLock(manager, itemId);
        if (lock) {
          await resourceLock(manager, lock);
        }
      },
    );
  }
  async create(userId: string, boardId: string, input: CreateItemRequest) {
    if (input.kind === 'image') {
      const retry = await this.access.withBoard(
        userId,
        boardId,
        'item.create',
        async (manager, access) => {
          const item = await this.repository.existing(manager, boardId, input.id);
          return item
            ? {
                item: await this.repository.response(
                  manager,
                  item,
                  access.role,
                  access.board.showPricesTo,
                ),
                created: false,
              }
            : null;
        },
        false,
      );
      if (retry) {
        return retry;
      }
      if (!this.assets) {
        throw new Error('Assets service missing');
      }
      await this.assets.assertUploaded(userId, boardId, input.assetId);
    }
    const hash = input.kind === 'link' ? createHash('sha256').update(input.url).digest() : null;
    return this.access.withBoard(
      userId,
      boardId,
      'item.create',
      async (manager, access) => {
        // A retry ignores changed input, including a section that has since been deleted.
        const existing = await this.repository.existing(manager, boardId, input.id);
        if (existing) {
          return {
            item: await this.repository.response(
              manager,
              existing,
              access.role,
              access.board.showPricesTo,
            ),
            created: false,
          };
        }
        await this.sections.assertOnBoard(manager, boardId, input.sectionId);
        let previewId: string | null = null;
        if (input.kind === 'image') {
          const asset = await this.assets!.load(manager, boardId, input.assetId);
          if (asset.status === 'failed') {
            throw new ConflictException('Asset processing failed');
          }
        }
        if (input.kind === 'link') {
          previewId = await this.previews.findOrCreate(manager, input.url, hash!);
        }
        const { item, created } = await this.repository.create(
          manager,
          boardId,
          access.participantId!,
          input,
          previewId,
        );
        if (created) {
          await this.events.append(manager, boardId, access.participantId!, {
            type: 'item.created',
            payload: {
              itemId: item.id,
              kind: input.kind,
              version: item.version,
              ...(item.assetId ? { assetId: item.assetId } : {}),
              ...(previewId ? { previewId } : {}),
            },
          });
        }
        return {
          item: await this.repository.response(
            manager,
            item,
            access.role,
            access.board.showPricesTo,
          ),
          created,
        };
      },
      true,
      hash ? (manager) => resourceLock(manager, `preview:${hash.toString('hex')}`) : undefined,
    );
  }
  async update(userId: string, itemId: string, input: UpdateNoteRequest) {
    const boardId = await this.repository.boardId(itemId);
    return this.access.withBoard(userId, boardId, 'item.edit', async (manager, access) => {
      const current = await this.repository.get(manager, boardId, itemId);
      if (current.deletedAt !== null) {
        throw new NotFoundException('Item not found');
      }
      const { item, changedFields } = await this.repository.update(manager, boardId, itemId, input);
      if (item === null) {
        throw new ConflictException({
          statusCode: 409,
          message: 'Item version conflict',
          currentItem: await this.repository.response(
            manager,
            current,
            access.role,
            access.board.showPricesTo,
          ),
        });
      }
      await this.events.append(manager, boardId, access.participantId!, {
        type: 'item.updated',
        payload: { itemId, version: item.version, changedFields },
      });
      if (access.board.workspaceType === 'business' && access.board.clientId !== null) {
        await this.approvals?.resetItem(
          manager,
          boardId,
          itemId,
          item.version,
          access.participantId,
        );
      }
      return await this.repository.response(manager, item, access.role, access.board.showPricesTo);
    });
  }
  async move(userId: string, itemId: string, input: MoveNoteRequest) {
    const boardId = await this.repository.boardId(itemId);
    return this.access.withBoard(userId, boardId, 'item.move', async (manager, access) => {
      const current = await this.repository.get(manager, boardId, itemId);
      if (current.deletedAt !== null) {
        throw new NotFoundException('Item not found');
      }
      await this.sections.assertOnBoard(manager, boardId, input.sectionId);
      const { item, changedFields } = await this.repository.move(manager, boardId, itemId, input);
      await this.events.append(manager, boardId, access.participantId!, {
        type: 'item.moved',
        payload: { itemId, changedFields },
      });
      return await this.repository.response(manager, item, access.role, access.board.showPricesTo);
    });
  }
  async delete(userId: string, itemId: string) {
    const boardId = await this.repository.boardId(itemId);
    return this.access.withBoard(userId, boardId, 'item.delete', async (manager, access) => {
      await this.repository.get(manager, boardId, itemId);
      if (await this.repository.delete(manager, boardId, itemId)) {
        await this.events.append(manager, boardId, access.participantId!, {
          type: 'item.deleted',
          payload: { itemId },
        });
      }
    });
  }
}

import { createHash, randomUUID } from 'node:crypto';
import { resourceLock } from '@moodboard/database';
import { AssetsService } from '../assets/assets.service';
import { ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { CreateItemRequest, MoveNoteRequest, UpdateNoteRequest } from '@moodboard/contracts';
import { AccessService } from '../access/access.service';
import { SectionsRepository } from '../sections/sections.repository';
import { BoardEventWriter } from '../../platform/events/board-event.writer';
import { ItemsRepository } from './items.repository';

@Injectable()
export class ItemsService {
  constructor(
    private readonly access: AccessService,
    private readonly repository: ItemsRepository,
    private readonly sections: SectionsRepository,
    private readonly events: BoardEventWriter,
    @Optional() private readonly assets?: AssetsService,
  ) {}
  list(userId: string, boardId: string) {
    return this.access.withBoard(
      userId,
      boardId,
      'board.view',
      async (manager, access) => {
        const items = await this.repository.list(manager, boardId);
        return this.repository.responses(manager, items, access.role, access.board.show_prices_to);
      },
      false,
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
                  access.board.show_prices_to,
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
              access.board.show_prices_to,
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
          await manager.query(
            'insert into link_previews (id,url,url_hash) values ($1,$2,$3) on conflict (url_hash) do nothing',
            [randomUUID(), input.url, hash],
          );
          const [preview] = await manager.query('select id from link_previews where url_hash=$1', [
            hash,
          ]);
          previewId = preview.id;
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
              ...(item.asset_id ? { assetId: item.asset_id } : {}),
              ...(previewId ? { previewId } : {}),
            },
          });
        }
        return {
          item: await this.repository.response(
            manager,
            item,
            access.role,
            access.board.show_prices_to,
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
      if (current.deleted_at !== null) {
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
            access.board.show_prices_to,
          ),
        });
      }
      await this.events.append(manager, boardId, access.participantId!, {
        type: 'item.updated',
        payload: { itemId, version: item.version, changedFields },
      });
      return await this.repository.response(
        manager,
        item,
        access.role,
        access.board.show_prices_to,
      );
    });
  }
  async move(userId: string, itemId: string, input: MoveNoteRequest) {
    const boardId = await this.repository.boardId(itemId);
    return this.access.withBoard(userId, boardId, 'item.move', async (manager, access) => {
      const current = await this.repository.get(manager, boardId, itemId);
      if (current.deleted_at !== null) {
        throw new NotFoundException('Item not found');
      }
      await this.sections.assertOnBoard(manager, boardId, input.sectionId);
      const { item, changedFields } = await this.repository.move(manager, boardId, itemId, input);
      await this.events.append(manager, boardId, access.participantId!, {
        type: 'item.moved',
        payload: { itemId, changedFields },
      });
      return await this.repository.response(
        manager,
        item,
        access.role,
        access.board.show_prices_to,
      );
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

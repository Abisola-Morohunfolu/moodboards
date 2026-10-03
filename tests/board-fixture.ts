import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AccessRepository } from '../apps/api/src/features/access/access.repository';
import { AccessService } from '../apps/api/src/features/access/access.service';
import { BoardsRepository } from '../apps/api/src/features/boards/boards.repository';
import { BoardsService } from '../apps/api/src/features/boards/boards.service';
import { SectionsRepository } from '../apps/api/src/features/sections/sections.repository';
import { SectionsService } from '../apps/api/src/features/sections/sections.service';
import { BoardEventWriter } from '../apps/api/src/platform/events/board-event.writer';

export function boardServices(source: DataSource) {
  const accessRepository = new AccessRepository();
  const access = new AccessService(source, accessRepository);
  const events = new BoardEventWriter();
  const sectionsRepository = new SectionsRepository();
  const boards = new BoardsService(
    source,
    new BoardsRepository(),
    access,
    accessRepository,
    events,
    sectionsRepository,
  );
  const sections = new SectionsService(access, sectionsRepository, events);
  return { accessRepository, access, events, sectionsRepository, boards, sections };
}
export async function boardUser(source: DataSource) {
  const id = randomUUID();
  await source.query('insert into users (id, email, display_name) values ($1,$2,$3)', [
    id,
    `${id}@example.com`,
    'Board tester',
  ]);
  return id;
}
export async function boardWorkspace(
  source: DataSource,
  type: 'personal' | 'business' = 'personal',
) {
  const userId = await boardUser(source);
  const workspaceId = randomUUID();
  await source.query('insert into workspaces (id, type, name) values ($1,$2,$3)', [
    workspaceId,
    type,
    'Workspace',
  ]);
  await source.query(
    "insert into workspace_members (workspace_id, user_id, role) values ($1,$2,'owner')",
    [workspaceId, userId],
  );
  return { userId, workspaceId };
}

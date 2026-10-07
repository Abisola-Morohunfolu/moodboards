import { UserEntity, AuthSessionEntity, GoogleAuthAttemptEntity } from './accounts/index';
import { WorkspaceEntity, WorkspaceMemberEntity } from './workspaces/index';
import { ClientEntity, ClientContactEntity } from './clients/index';
import {
  BoardEntity,
  BoardParticipantEntity,
  ContactSessionEntity,
  SectionEntity,
  ItemEntity,
} from './boards/index';
import { LinkPreviewEntity, AssetEntity } from './media/index';
import { BoardEventEntity, BoardEventDeliveryEntity } from './outbox/index';
import { ApprovalStateEntity, ApprovalDecisionEntity } from './approvals/index';

export * from './accounts/index';
export * from './workspaces/index';
export * from './clients/index';
export * from './boards/index';
export * from './media/index';
export * from './outbox/index';
export * from './approvals/index';

export const databaseEntities = [
  UserEntity,
  AuthSessionEntity,
  GoogleAuthAttemptEntity,
  WorkspaceEntity,
  WorkspaceMemberEntity,
  ClientEntity,
  ClientContactEntity,
  BoardEntity,
  BoardParticipantEntity,
  ContactSessionEntity,
  SectionEntity,
  ItemEntity,
  LinkPreviewEntity,
  AssetEntity,
  BoardEventEntity,
  BoardEventDeliveryEntity,
  ApprovalStateEntity,
  ApprovalDecisionEntity,
];

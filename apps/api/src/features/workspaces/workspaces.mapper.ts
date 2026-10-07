import { WorkspaceResponse } from '@moodboard/contracts';
import { WorkspaceEntity, WorkspaceMemberEntity } from '@moodboard/database';
export function workspaceResponse(
  workspace: WorkspaceEntity,
  role: WorkspaceMemberEntity['role'],
): WorkspaceResponse {
  return {
    id: workspace.id,
    type: workspace.type,
    name: workspace.name,
    logoKey: workspace.logoKey,
    brandColour: workspace.brandColour,
    createdAt: workspace.createdAt.toISOString(),
    role,
  };
}

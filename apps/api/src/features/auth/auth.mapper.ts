import { UserResponse } from '@moodboard/contracts';
import { UserEntity } from '@moodboard/database';
export function userResponse(user: UserEntity): UserResponse {
  return {
    id: user.id,
    email: user.email!,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt.toISOString(),
  };
}

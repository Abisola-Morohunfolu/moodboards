import { SectionResponse } from '@moodboard/contracts';
import { SectionEntity } from '@moodboard/database';
export function sectionResponse(section: SectionEntity): SectionResponse {
  return {
    id: section.id,
    boardId: section.boardId,
    name: section.name,
    position: section.position,
  };
}

import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { Editor } from '../features/board/Editor';
export const Route = createFileRoute('/boards/$boardId')({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { item?: string } => ({
    item: z.uuid().optional().catch(undefined).parse(search.item),
  }),
  component: BoardEditor,
});
function BoardEditor() {
  const { boardId } = Route.useParams();
  const { item } = Route.useSearch();
  return <Editor key={boardId} boardId={boardId} targetItem={item} />;
}

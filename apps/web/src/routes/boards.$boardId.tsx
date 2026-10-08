import { createFileRoute } from '@tanstack/react-router';
import { Editor } from '../features/board/Editor';
export const Route = createFileRoute('/boards/$boardId')({
  ssr: false,
  component: BoardEditor,
});
function BoardEditor() {
  const { boardId } = Route.useParams();
  return <Editor key={boardId} boardId={boardId} />;
}

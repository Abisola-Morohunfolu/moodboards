import { createFileRoute } from '@tanstack/react-router';
import { Editor } from '../features/board/Editor';
export const Route = createFileRoute('/boards/$boardId')({
  ssr: false,
  component: () => <Editor boardId={Route.useParams().boardId} />,
});

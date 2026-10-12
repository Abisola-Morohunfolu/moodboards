import { createFileRoute } from '@tanstack/react-router';
import { BetaInfo, SupportContact } from '../components/BetaInfo';
export const Route = createFileRoute('/privacy')({ component: Page });
function Page() {
  return (
    <BetaInfo title="Private beta privacy notice">
      <section>
        <h2>Information used to run your boards</h2>
        <p>
          Moodboard stores your account email, display name, a password hash, sessions, workspaces,
          boards, images, links, notes, and any business contacts and approval feedback you enter.
          Essential cookies keep account and client-link sessions signed in.
        </p>
        <p>
          The API, database, media worker, and private object storage process this information to
          save, retrieve, and display your boards. Link previews fetch the web addresses you save;
          the destination site receives a request from the preview service. Operational logs and
          authentication rate limits help diagnose failures and limit abuse.
        </p>
      </section>
      <section>
        <h2>Who can view your work</h2>
        <p>
          Personal boards require account access. Business boards follow workspace and board
          permissions. A client link grants its holder access to the single board and role you
          chose. Revoke a link when access should end. Signed image URLs expire, but recipients can
          download images they can view.
        </p>
      </section>
      <section>
        <h2>Retention and requests</h2>
        <p>
          Moving an item to Trash hides it from active views and keeps its content and referenced
          media indefinitely during beta so you can restore it. It does not permanently delete the
          item. Database backups may retain older copies after changes or deletion; the beta
          operator must explain the configured backup retention when responding to your request.
        </p>
        <p>
          Contact <SupportContact /> to request access, correction, export assistance, or
          account/data deletion. The operator verifies identity and explains the scope and timing
          before acting, including shared business records and backups.
        </p>
      </section>
      <section>
        <h2>Before using the beta</h2>
        <p>
          Use the contact in your invitation to identify the beta operator and ask about the hosting
          providers, region, and backup retention for this deployment. These depend on the
          operator's setup. Avoid sensitive personal information during this early beta.
        </p>
      </section>
    </BetaInfo>
  );
}

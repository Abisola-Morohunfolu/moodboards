import { createFileRoute } from '@tanstack/react-router';
import { BetaInfo, SupportContact } from '../components/BetaInfo';
export const Route = createFileRoute('/terms')({ component: Page });
function Page() {
  return (
    <BetaInfo title="Private beta terms">
      <section>
        <h2>An invited, free beta</h2>
        <p>
          Moodboard is an early, free service for invited board-makers. Features and availability
          can change. Keep original files and another copy of anything essential. General
          personal-board sharing, offline saving, and persistent unfinished captures are not
          available.
        </p>
      </section>
      <section>
        <h2>Your content and access</h2>
        <p>
          You retain your rights in content you add. Add only material you are entitled to store and
          share. You allow the service to store and process that material to provide your boards,
          previews, and the sharing you request.
        </p>
        <p>
          Keep account credentials and client links private. Do not upload unlawful material, misuse
          other people's information, bypass permissions, or disrupt the service. The beta operator
          may restrict access to address abuse or operational problems.
        </p>
      </section>
      <section>
        <h2>Beta boundaries</h2>
        <p>
          The invited cohort starts at up to 25 accounts, with a supported target of 200 active
          items per board and 1 GiB of retained original uploads per account. These are monitored
          beta boundaries, not automatic quotas. Trash still retains media. Each image is limited to
          10 MiB. Contact the operator before going beyond these boundaries.
        </p>
      </section>
      <section>
        <h2>Help and leaving the beta</h2>
        <p>
          Contact <SupportContact /> with feedback or an account/data deletion request. Account
          recovery and deletion are handled with identity checks by the beta operator. Ask the
          person who invited you about the operator and deployment details before joining.
        </p>
      </section>
    </BetaInfo>
  );
}

import { createFileRoute } from '@tanstack/react-router';
import { BetaInfo, SupportContact } from '../components/BetaInfo';
export const Route = createFileRoute('/help')({ component: Page });
function Page() {
  return (
    <BetaInfo title="Help with your board">
      <section>
        <h2>Capture your first idea</h2>
        <p>
          Create a board, then use Add text or Add images. Paste text or a web address onto the
          board. On desktop, you can also drop image files onto the canvas. JPEG, PNG, and WebP
          files up to 10 MiB are supported.
        </p>
      </section>
      <section>
        <h2>Know what is saved</h2>
        <p>
          The capture tray shows each save. Once an item is saved, its card stays on your board even
          while an image or link preview is processing. Unfinished captures live only in this open
          tab: wait for saves or resolve retries before leaving. Reloading discards unfinished
          inputs.
        </p>
      </section>
      <section>
        <h2>Organize and return</h2>
        <p>
          Use sections to group ideas. Move cards on the desktop canvas by dragging or with the
          arrow keys when a card is focused. Search from Your boards to find saved ideas. Items
          moved to Trash can be restored; trash does not expire during beta.
        </p>
      </section>
      <section>
        <h2>Sharing during beta</h2>
        <p>
          Personal boards stay private. In a business workspace, the board owner can associate a
          client and create a board-specific viewer or approver link. Anyone holding that link can
          use it until it expires or is revoked. Treat it as private.
        </p>
      </section>
      <section>
        <h2>Access, feedback, and deletion requests</h2>
        <p>
          Contact <SupportContact /> for a forgotten password, a failed image, a problem, or an
          account/data deletion request. Use the email you signed up with. The beta operator checks
          your identity before changing account access or deleting data. Never send your password or
          a private share link.
        </p>
        <p>
          For a failed image, keep the original file and ask for help before removing the saved
          card. Include your browser, device, what you were doing, and any visible error; omit
          private board content from screenshots.
        </p>
      </section>
    </BetaInfo>
  );
}

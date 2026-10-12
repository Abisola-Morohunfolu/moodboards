import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

const api = 'http://127.0.0.1:3011';
async function signup(page: Page) {
  // Each test context represents a separate client behind the trusted test proxy.
  await page.context().setExtraHTTPHeaders({
    'X-Forwarded-For': `2001:db8:${randomUUID().slice(0, 4)}:${randomUUID().slice(0, 4)}::1`,
  });
  await page.goto('/login?mode=signup');
  await page.getByLabel('Your name', { exact: true }).fill('Beta tester');
  await page.getByLabel('Email address', { exact: true }).fill(`${randomUUID()}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your boards', exact: true })).toBeVisible();
}
async function board(page: Page, title: string) {
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await page.getByLabel('Board title', { exact: true }).fill(title);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  return page.url().split('/').at(-1)!.split('?')[0]!;
}
async function saveText(page: Page, title: string, text: string) {
  await page
    .getByRole('button', { name: 'Note or link', exact: true })
    .filter({ visible: true })
    .click();
  await page.getByLabel('Title (optional)', { exact: true }).fill(title);
  await page.getByLabel('Text or web addresses', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Add to board', exact: true }).click();
}
const visibleCard = (page: Page, title: string) =>
  page.getByRole('button', { name: title, exact: true }).filter({ visible: true });

test('personal capture, rename, movement, reload, search, trash, and restore', async ({
  page,
}, info) => {
  if (info.project.name === 'chromium') {
    await page.clock.install();
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signup(page);
  const id = await board(page, 'Beta ideas');
  await expect(page.getByRole('button', { name: 'Share board', exact: true })).toHaveCount(0);
  await saveText(page, 'Return idea', 'Keep this saved note for tomorrow.');
  await expect(visibleCard(page, 'Return idea')).toBeVisible();
  if (info.project.name !== 'mobile') {
    const move = page
      .getByRole('button', { name: 'Move item; use arrow keys for keyboard movement', exact: true })
      .filter({ visible: true });
    const position = async () =>
      (await (await page.request.get(`${api}/boards/${id}/items`)).json()).find(
        (item: { title: string }) => item.title === 'Return idea',
      ).x;
    const before = await position();
    await move.focus();
    await move.press('ArrowRight');
    await expect.poll(position).toBeGreaterThan(before);
    const afterKey = await position();
    const box = await move.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + 40, box!.y + box!.height / 2 + 20, {
      steps: 5,
    });
    await page.mouse.up();
    await expect.poll(position).toBeGreaterThan(afterKey);
  }
  const image = await sharp({
    create: { width: 80, height: 60, channels: 3, background: '#315bd8' },
  })
    .png()
    .toBuffer();
  await page
    .getByLabel('Choose images to add', { exact: true })
    .setInputFiles({ name: 'beta-image.png', mimeType: 'image/png', buffer: image });
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`${api}/boards/${id}/items`)).json()).find(
          (item: { kind: string }) => item.kind === 'image',
        )?.asset.status,
      { timeout: 30_000 },
    )
    .toBe('ready');
  await expect(page.locator('img').filter({ visible: true }).first()).toBeVisible();
  await saveText(page, 'Reference link', 'https://example.com/');
  await expect(
    page.getByRole('link', { name: 'example.com', exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Rename board', exact: true }).click();
  await page.getByLabel('Board title', { exact: true }).fill('Renamed beta ideas');
  await page.getByRole('button', { name: 'Save title', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Renamed beta ideas', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(visibleCard(page, 'Return idea')).toBeVisible();
  await page.getByRole('link', { name: 'Back to boards', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Renamed beta ideas', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Rename Renamed beta ideas', exact: true }).click();
  await page.getByLabel('Board title', { exact: true }).fill('Gallery renamed ideas');
  await page.getByRole('button', { name: 'Save title', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Rename board', exact: true })).toHaveCount(0);
  await page.getByLabel('Search this workspace', { exact: true }).fill('Return idea');
  await page.getByRole('link', { name: 'Open Return idea', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Gallery renamed ideas', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Item details', exact: true })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Move to trash', exact: true }).click();
  await expect(visibleCard(page, 'Return idea')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open board trash', exact: true }).click();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.getByText('Item restored to the board.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View item', exact: true }).click();
  await expect(visibleCard(page, 'Return idea')).toBeVisible();
  await page.getByRole('button', { name: 'Close details', exact: true }).click();
  if (info.project.name === 'chromium') {
    let refreshed = 0;
    page.on('request', (request) => {
      if (request.url().includes('/assets/') && request.url().includes('/url')) {
        refreshed += 1;
      }
    });
    await page.clock.fastForward(240_100);
    await expect.poll(() => refreshed).toBeGreaterThan(0);
    await page.clock.resume();
  }
  if (['chromium', 'mobile'].includes(info.project.name)) {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.screenshot({ path: info.outputPath('core-light.png'), fullPage: true });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: info.outputPath('core-dark.png'), fullPage: true });
  }
});

test('business sharing keeps a usable link when clipboard is denied, rotates, and revokes', async ({
  page,
  browser,
}) => {
  await signup(page);
  await page.context().addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error('Clipboard denied');
        },
      },
    });
  });
  const workspace = await (
    await page.request.post(`${api}/workspaces`, {
      data: { name: 'Beta studio' },
    })
  ).json();
  const client = await (
    await page.request.post(`${api}/workspaces/${workspace.id}/clients`, {
      data: { name: 'Test client' },
    })
  ).json();
  await page.request.post(`${api}/clients/${client.id}/contacts`, {
    data: { name: 'Test viewer', email: `${randomUUID()}@example.com` },
  });
  await page.goto(`/boards?workspace=${workspace.id}`);
  await board(page, 'Client ideas');
  await saveText(page, 'Client note', 'A note for the client.');
  await expect(visibleCard(page, 'Client note')).toBeVisible();
  await page.getByRole('button', { name: 'Share board', exact: true }).click();
  await page.getByLabel('Client', { exact: true }).selectOption(client.id);
  await page.getByRole('button', { name: 'Associate', exact: true }).click();
  await page.getByLabel('Contact', { exact: true }).selectOption({ label: 'Test viewer' });
  await page.getByRole('button', { name: 'Add and copy link', exact: true }).click();
  const field = page.getByLabel('Contact link', { exact: true });
  await expect(field).toBeVisible();
  await expect(
    page.getByText('Link is ready. Copy it from the field below.', { exact: true }),
  ).toBeVisible();
  const original = await field.inputValue();
  let rotations = 0;
  page.on('request', (request) => {
    if (request.url().includes('/rotate')) {
      rotations += 1;
    }
  });
  await page.getByRole('button', { name: 'Copy ready link', exact: true }).click();
  expect(await field.inputValue()).toBe(original);
  expect(rotations).toBe(0);
  const guest = await browser.newContext();
  const viewer = await guest.newPage();
  await viewer.goto(original);
  await expect(viewer.getByRole('heading', { name: 'Client ideas', exact: true })).toBeVisible();
  await expect(viewer.getByText('Client note', { exact: true })).toBeVisible();
  await expect(viewer.getByRole('button', { name: 'Review', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Rotate link', exact: true }).click();
  await expect(field).not.toHaveValue(original);
  await viewer.goto(original);
  await expect(viewer.getByRole('alert')).toContainText(
    'This link has expired or is no longer available.',
  );
  await viewer.goto(await field.inputValue());
  await expect(viewer.getByRole('heading', { name: 'Client ideas', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Revoke access', exact: true }).click();
  await expect(field).toHaveCount(0);
  await viewer.reload();
  await expect(viewer.getByRole('heading', { name: /unavailable/i })).toBeVisible();
  await guest.close();
});

test('help and policies render and a lost session cannot reopen a private board', async ({
  page,
}) => {
  await page.goto('/help');
  await expect(
    page.getByRole('heading', { name: 'Capture your first idea', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Privacy', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Private beta privacy notice', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Beta terms', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Private beta terms', exact: true }),
  ).toBeVisible();
  await signup(page);
  await board(page, 'Session test');
  await page.context().clearCookies();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'This board is unavailable.', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Back to boards', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
});

test('uncertain saves retry one immutable item and warn before navigation', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'chromium', 'One focused fault-injection smoke is sufficient.');
  await signup(page);
  const id = await board(page, 'Retry ideas');
  const payloads: { id: string; title: string }[] = [];
  await page.route(`${api}/boards/${id}/items`, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    payloads.push(route.request().postDataJSON());
    if (payloads.length === 1) {
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort('failed');
    } else {
      await route.continue();
    }
  });
  await saveText(page, 'Retry note', 'Keep a single saved copy.');
  await expect(page.getByRole('button', { name: 'Retry same save', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back to boards', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Leave this board?', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stay on board', exact: true }).click();
  await page.getByRole('button', { name: 'Retry same save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry same save', exact: true })).toHaveCount(0);
  expect(payloads).toHaveLength(2);
  expect(payloads[1]).toEqual(payloads[0]);
  const rows = await (await page.request.get(`${api}/boards/${id}/items`)).json();
  expect(rows.filter((item: { title: string }) => item.title === 'Retry note')).toHaveLength(1);
  await expect(visibleCard(page, 'Retry note')).toBeVisible();
});

test('200-item board remains usable while another account uses its own board', async ({
  page,
  browser,
}, info) => {
  test.skip(
    info.project.name !== 'chromium',
    'One representative-size acceptance check is sufficient.',
  );
  await signup(page);
  const id = await board(page, 'Two hundred ideas');
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await signup(other);
  await board(other, 'Separate ideas');
  for (let start = 0; start < 200; start += 10) {
    await Promise.all(
      Array.from({ length: 10 }, async (_, offset) => {
        const index = start + offset;
        const response = await page.request.post(`${api}/boards/${id}/items`, {
          data: {
            id: randomUUID(),
            kind: 'note',
            title: `Idea ${index}`,
            note: `Saved reference ${index}`,
            zOrder: index.toString(36),
            x: (index % 10) * 270,
            y: Math.floor(index / 10) * 180,
          },
        });
        expect(response.status()).toBe(201);
      }),
    );
  }
  await Promise.all([
    page.reload(),
    saveText(other, 'Other account note', 'Saved while the large board loads.'),
  ]);
  await expect(visibleCard(page, 'Idea 0')).toBeVisible();
  await expect(visibleCard(other, 'Other account note')).toBeVisible();
  expect(await (await page.request.get(`${api}/boards/${id}/items`)).json()).toHaveLength(200);
  expect((await other.request.get(`${api}/boards/${id}`)).status()).toBe(404);
  await page.getByRole('link', { name: 'Back to boards', exact: true }).click();
  await page.getByLabel('Search this workspace', { exact: true }).fill('Saved reference 199');
  await page.getByRole('link', { name: 'Open Idea 199', exact: true }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Idea 199');
  await otherContext.close();
});

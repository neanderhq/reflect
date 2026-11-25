import assert from 'node:assert/strict';
import { join } from 'node:path';
import { expect, type Browser, type Locator, type Page } from '@playwright/test';
import { openView, signIn } from './verify-workspace-interactions';

const phone = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' as const };
const desktop = { viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' as const };
const spring = 'Spring review history';

async function fitPhone(page: Page, dialog?: Locator) {
  expect(await page.evaluate(() => ({
    viewport: window.innerWidth, content: document.documentElement.scrollWidth,
  }))).toEqual({ viewport: 375, content: 375 });
  if (dialog) {
    expect(await dialog.evaluate(element => ({
      fits: element.scrollWidth <= element.clientWidth,
      aboveBottom: element.getBoundingClientRect().bottom <= window.innerHeight,
    }))).toEqual({ fits: true, aboveBottom: true });
  }
}

async function keyboardOpen(page: Page, button: Locator) {
  await button.focus();
  await page.keyboard.press('Enter');
}

async function tabTo(page: Page, target: Locator) {
  for (let attempt = 0; attempt < 15; attempt++) {
    if (await target.evaluate(element => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

export async function verifyFollowUp(browser: Browser, origin: string, password: string, capture?: string) {
  const alex = await browser.newPage(phone);
  const blair = await browser.newPage(desktop);
  const hr = await browser.newPage(phone);
  const hrDesktop = await browser.newPage(desktop);
  for (const page of [alex, blair, hr, hrDesktop]) page.setDefaultTimeout(15000);
  const api = async (page: Page, command: string, values: Record<string, unknown>) => {
    const response = await page.request.post(origin + '/api/workspace', {
      headers: { origin, 'X-Lattice-Request': '1' }, data: { command, ...values },
    });
    assert.equal(response.status(), 200, await response.text());
    return response.json();
  };
  const shot = async (page: Page, name: string) => {
    if (capture) await page.screenshot({ path: join(capture, 'screenshots', name + '.png') });
  };

  try {
    await signIn(alex, origin, 'alex@reflect.test', password);
    await openView(alex, 'History', 'History');
    const goalButton = alex.getByRole('button', { name: 'Create development goal' });
    await keyboardOpen(alex, goalButton);
    const goal = alex.getByRole('dialog', { name: 'Create development goal' });
    await fitPhone(alex, goal);
    await expect(goal.getByLabel('Goal title')).toBeFocused();
    await alex.keyboard.type(' ');
    await alex.keyboard.press('Tab');
    await expect(goal.getByLabel('What will success look like?')).toBeFocused();
    await alex.keyboard.type('Lead two project check-ins with a clear next step.');
    await alex.keyboard.press('Tab');
    await expect(goal.getByLabel('First action')).toBeFocused();
    await alex.keyboard.type('Prepare an agenda');
    await goal.getByLabel('Action due date').fill('2027-01-10');
    await tabTo(alex, goal.getByRole('button', { name: 'Save goal' }));
    await alex.keyboard.press('Enter');
    await expect(goal.getByRole('alert')).toHaveText('Enter a goal title and a success measure.');
    await expect(goal.getByLabel('First action')).toHaveValue('Prepare an agenda');
    await shot(alex, 'phone-goal-recovery');
    await goal.getByLabel('Goal title').fill('Lead clearer check-ins');
    await tabTo(alex, goal.getByRole('button', { name: 'Save goal' }));
    await alex.keyboard.press('Enter');
    await expect(alex.getByRole('heading', { name: 'Development actions', exact: true })).toBeVisible();
    await expect(goal).toBeHidden();
    await expect(alex.getByRole('heading', { name: 'Development actions', exact: true })).toBeFocused();
    await expect(alex.getByText('Lead clearer check-ins', { exact: true })).toBeVisible();
    await fitPhone(alex);
    await shot(alex, 'phone-development-goal');
    await alex.reload();
    const update = alex.getByRole('button', { name: /Update development action.*Prepare an agenda/ });
    await keyboardOpen(alex, update);
    const action = alex.getByRole('dialog', { name: 'Update development action' });
    await action.getByLabel('Progress').selectOption('complete');
    await tabTo(alex, action.getByRole('button', { name: 'Save action' }));
    await alex.keyboard.press('Enter');
    await expect(action).toBeHidden();
    await expect(update).toBeFocused();
    await alex.reload();
    await expect(alex.getByText('complete', { exact: true })).toBeVisible();
    await alex.getByRole('link', { name: /View source packet · v1/ }).click();
    await expect(alex.getByText(/Immutable version 1/)).toBeVisible();
    await expect(alex.getByText('Alex delivered clear, thoughtful work.')).toBeVisible();

    await signIn(hrDesktop, origin, 'hr@reflect.test', password);
    await openView(hrDesktop, 'Development Actions', 'Development actions');
    await expect(hrDesktop.getByText('Lead clearer check-ins', { exact: true })).toBeVisible();
    await expect(hrDesktop.getByRole('button', { name: 'Edit goal' })).toHaveCount(0);
    await shot(hrDesktop, 'desktop-development-goal');
    console.log('PASS: packet-linked goal, invalid-input recovery, persisted action, source link and read-only HR');

    await signIn(hr, origin, 'hr@reflect.test', password);
    const summary = async (subjectId: string) => api(hrDesktop, 'summary', {
      cycleId: 'spring-history', subjectId, text: 'Fictional evidence for the closeout check.', rating: 3, revision: 0,
    });
    const blairSummary = await summary('blair');
    await summary('casey');
    await openView(hr, 'Cycles', 'Review cycles');
    const queueButton = hr.getByRole('button', { name: `Cycle closeout — ${spring}` });
    await keyboardOpen(hr, queueButton);
    const queue = hr.getByRole('dialog', { name: `Cycle closeout · ${spring}` });
    await expect(queue.getByText('Manager summary is missing').first()).toBeVisible();
    await expect(queue.getByText('Version 1', { exact: true })).toBeVisible();
    await expect(queue.getByText('Ready', { exact: true })).toHaveCount(2);
    await fitPhone(hr, queue);
    await shot(hr, 'phone-closeout-queue');
    const blairBox = queue.getByRole('checkbox', { name: 'Blair Patel' });
    const caseyBox = queue.getByRole('checkbox', { name: 'Casey Rossi' });
    const review = queue.getByRole('button', { name: /^Review release/ });
    for (const checkbox of [blairBox, caseyBox]) {
      await tabTo(hr, checkbox);
      await hr.keyboard.press('Space');
      await expect(checkbox).toBeChecked();
    }
    await tabTo(hr, review);
    await hr.keyboard.press('Enter');
    await expect(queue.getByRole('heading', { name: 'Confirm first release' })).toBeFocused();
    await expect(queue.getByRole('listitem')).toHaveText(['Blair Patel', 'Casey Rossi']);
    const confirm = queue.getByRole('button', { name: 'Confirm release' });
    await fitPhone(hr, queue);
    await shot(hr, 'phone-closeout-confirmation');
    await api(hrDesktop, 'calibrate', { id: blairSummary.id, revision: blairSummary.revision, rating: 4, reason: 'Compare fictional project scope' });
    await tabTo(hr, confirm);
    await hr.keyboard.press('Enter');
    const stale = queue.getByRole('alert');
    await expect(stale).toContainText('No packets were released in this batch.');
    await expect(stale).toBeFocused();
    const refresh = queue.getByRole('button', { name: 'Refresh queue' });
    await tabTo(hr, refresh);
    await hr.keyboard.press('Enter');
    await expect(queue.getByRole('status')).toContainText('Queue refreshed.');
    await expect(blairBox).not.toBeChecked();
    await expect(caseyBox).not.toBeChecked();
    for (const checkbox of [blairBox, caseyBox]) {
      await tabTo(hr, checkbox);
      await hr.keyboard.press('Space');
    }
    await tabTo(hr, review);
    await hr.keyboard.press('Enter');
    await tabTo(hr, confirm);
    await hr.keyboard.press('Enter');
    await expect(queue.getByRole('status')).toHaveText('Released 2 packets. The cycle stays open.');
    await expect(queue.getByText('Released', { exact: true })).toHaveCount(3);
    await hr.keyboard.press('Escape');
    await expect(queue).toBeHidden();
    await expect(queueButton).toBeFocused();

    await signIn(blair, origin, 'blair@reflect.test', password);
    await openView(blair, 'History', 'History');
    await expect(blair.getByText(/Immutable version 1/)).toBeVisible();
    await blair.getByRole('button', { name: 'Acknowledge this version' }).click();
    await expect(blair.getByText('Acknowledged', { exact: true })).toBeVisible();
    await openView(hrDesktop, 'Cycles', 'Review cycles');
    await hrDesktop.getByRole('button', { name: `Cycle closeout — ${spring}` }).click();
    const desktopQueue = hrDesktop.getByRole('dialog', { name: `Cycle closeout · ${spring}` });
    await expect(desktopQueue.getByText('Acknowledged', { exact: true })).toBeVisible();
    await shot(hrDesktop, 'desktop-closeout-acknowledged');
    await hrDesktop.keyboard.press('Escape');
    await openView(blair, 'Cycles', 'Review cycles');
    await expect(blair.getByRole('button', { name: /Cycle closeout/ })).toHaveCount(0);
    console.log('PASS: HR-only readiness, keyboard first release, stale-batch recovery and employee acknowledgment');

    await openView(alex, /^Advice/, 'Private advice');
    const create = alex.getByRole('button', { name: 'New request' });
    const compose = alex.getByRole('dialog', { name: 'Ask for private advice' });
    async function send(question: string, checkValidation = false) {
      await keyboardOpen(alex, create);
      const address = compose.getByRole('textbox', { name: /workspace email/ });
      await expect(address).toBeFocused();
      await fitPhone(alex, compose);
      await alex.keyboard.type(checkValidation ? 'missing@reflect.test' : 'blair@reflect.test');
      await alex.keyboard.press('Tab');
      await expect(compose.getByRole('textbox', { name: /what would you like advice on/i })).toBeFocused();
      await alex.keyboard.type(question);
      await alex.keyboard.press('Tab');
      await expect(compose.getByRole('button', { name: 'Send request' })).toBeFocused();
      await alex.keyboard.press('Enter');
      if (checkValidation) {
        await expect(compose.getByRole('alert')).toHaveText('Enter the workspace email of an active colleague.');
        await expect(compose.getByRole('textbox', { name: /what would you like advice on/i })).toHaveValue(question);
        await shot(alex, 'phone-advice-recovery');
        await address.fill('blair@reflect.test');
        await tabTo(alex, compose.getByRole('button', { name: 'Send request' }));
        await alex.keyboard.press('Enter');
      }
      await expect(compose).toBeHidden();
      await expect(create).toBeFocused();
      await expect(alex.getByText(question, { exact: true })).toBeVisible();
    }
    const question = 'How can I make project updates clearer?';
    const reply = 'Lead with the decision and one next step.';
    await send(question, true);
    await blair.reload();
    const inbox = blair.getByRole('navigation').getByRole('button', { name: /^Advice/ });
    await expect(inbox).toHaveAccessibleName(/1 request awaiting your reply/);
    await openView(blair, /^Advice/, 'Private advice');
    await expect(blair.getByText(question, { exact: true })).toBeVisible();
    await shot(blair, 'desktop-advice-pending');
    await keyboardOpen(blair, blair.getByRole('button', { name: 'Reply', exact: true }));
    const response = blair.getByRole('dialog', { name: 'Reply to Alex Chen' });
    await expect(response.getByLabel('Your advice')).toBeFocused();
    await blair.keyboard.type(reply);
    await blair.keyboard.press('Tab');
    await expect(response.getByRole('button', { name: 'Send reply' })).toBeFocused();
    await blair.keyboard.press('Enter');
    await expect(response).toBeHidden();
    await expect(blair.getByText('Answered', { exact: true })).toBeVisible();
    await expect(inbox).toHaveAccessibleName('Advice');
    await alex.reload();
    await expect(alex.getByText(reply, { exact: true })).toBeVisible();
    await fitPhone(alex);
    await shot(alex, 'phone-advice-answered');

    await send('An example request I will cancel.');
    await alex.getByRole('button', { name: 'Cancel request' }).click();
    await alex.getByRole('button', { name: 'Confirm cancellation' }).click();
    await expect(alex.getByText('Canceled', { exact: true })).toBeVisible();
    await send('An example request you can decline.');
    await blair.reload();
    await blair.getByRole('button', { name: 'Decline', exact: true }).click();
    await blair.getByRole('button', { name: 'Confirm decline' }).click();
    await expect(blair.getByText('Declined', { exact: true })).toBeVisible();
    await alex.reload();
    await expect(alex.getByText('Declined', { exact: true })).toBeVisible();
    const data = await api(alex, 'workspace', {});
    await hrDesktop.goto(origin + '/?view=advice&request=' + data.advice.find((r: { question: string }) => r.question === question).id);
    await expect(hrDesktop.getByText('This request is unavailable.')).toBeVisible();
    await expect(hrDesktop.getByText(question, { exact: true })).toHaveCount(0);
    const backup = await hrDesktop.request.get(origin + '/api/backup');
    assert.equal(backup.status(), 200);
    const body = await backup.text();
    assert.ok(!body.includes(question) && !body.includes(reply) && !body.includes('adviceRequests'));
    console.log('PASS: phone compose recovery, participant inbox/reply, durable cancellation and decline, private deep link and backup exclusion');
  } finally {
    await Promise.all([alex.close(), blair.close(), hr.close(), hrDesktop.close()]);
  }
}

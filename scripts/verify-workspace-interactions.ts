import { expect, type Browser, type Page } from '@playwright/test';
import { DEMO_COMPANY } from './seed-template';

export async function signIn(page: Page, origin: string, email: string, password: string) {
  await page.goto(origin + '/login');
  await page.getByLabel('Workspace ID').fill(DEMO_COMPANY);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
}

export async function openView(page: Page, label: string | RegExp, heading: string) {
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: label }).click();
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
}

async function checkReports(page: Page) {
  const reportType = page.getByLabel('Filter report type');
  const isReport = (url: string, type: string) => {
    const parsed = new URL(url);
    return parsed.pathname === '/api/export' && parsed.searchParams.get('type') === type;
  };
  let releaseOld!: () => void;
  const oldResponseGate = new Promise<void>(resolve => { releaseOld = resolve; });
  await page.route('**/api/export?*', async route => {
    if (isReport(route.request().url(), 'self')) await oldResponseGate;
    await route.continue();
  });
  try {
    const oldRequest = page.waitForRequest(request => isReport(request.url(), 'self'));
    await reportType.selectOption('self');
    await oldRequest;
    await reportType.selectOption('manager');
    const typeCells = page.getByRole('table').locator('tbody tr td:nth-child(2)');
    await expect(typeCells.first()).toHaveText('manager');

    const older = page.waitForResponse(response => isReport(response.url(), 'self'));
    releaseOld();
    await (await older).finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const visibleTypes = await typeCells.allTextContents();
    expect(visibleTypes.length).toBeGreaterThan(0);
    expect([...new Set(visibleTypes)]).toEqual(['manager']);
    await expect(page.getByRole('link', { name: 'CSV' })).toHaveAttribute('href', /[?&]type=manager(?:&|$)/);
  } finally {
    releaseOld();
    await page.unrouteAll({ behavior: 'wait' });
  }
}

export async function verifyWorkspaceInteractions(browser: Browser, origin: string, password: string) {
  const phoneOptions = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' as const };
  const hr = await browser.newPage(phoneOptions);
  const employee = await browser.newPage(phoneOptions);
  for (const page of [hr, employee]) page.setDefaultTimeout(15000);

  try {
    await signIn(hr, origin, 'hr@reflect.test', password);
    await openView(hr, 'Cycles', 'Review cycles');
    expect(await hr.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
    await openView(hr, 'Reports', 'Reports');
    await checkReports(hr);
    expect(await hr.evaluate(() => document.documentElement.scrollWidth)).toBe(375);

    await openView(hr, 'People', 'People');
    const edit = hr.getByRole('button', { name: 'Edit Alex Chen' });
    const editBounds = await edit.boundingBox();
    expect(editBounds).not.toBeNull();
    expect(editBounds!.x + editBounds!.width).toBeLessThanOrEqual(375);
    expect(await hr.evaluate(() => document.documentElement.scrollWidth)).toBe(375);

    const importButton = hr.getByRole('button', { name: 'Import people', exact: true });
    await importButton.focus();
    await hr.keyboard.press('Enter');
    const importDialog = hr.getByRole('dialog', { name: 'Import people' });
    await expect(importDialog.getByLabel('Choose a CSV file')).toBeFocused();
    await hr.keyboard.press('Shift+Tab');
    await expect(importDialog.getByRole('link', { name: 'Download CSV template' })).toBeFocused();
    await hr.keyboard.press('Tab');
    await expect(importDialog.getByLabel('Choose a CSV file')).toBeFocused();
    await hr.keyboard.press('Tab');
    await expect(importDialog.getByLabel('CSV content')).toBeFocused();
    await hr.keyboard.press('Escape');
    await expect(importDialog).toBeHidden();
    await expect(importButton).toBeFocused();

    await signIn(employee, origin, 'alex@reflect.test', password);
    await openView(employee, /My Reviews/, 'Reviews');
    const trigger = employee.getByRole('button', { name: /Your self reflection.*Autumn growth reviews/ });
    const dialog = employee.getByRole('dialog', { name: 'Your self reflection' });
    const answer = dialog.getByRole('textbox');
    await trigger.focus();
    await employee.keyboard.press('Enter');
    await expect(answer).toBeFocused();
    await employee.keyboard.press('Tab');
    await expect(dialog.getByRole('combobox')).toBeFocused();
    await employee.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Save draft' })).toBeFocused();
    await employee.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await employee.keyboard.press('Enter');
    await answer.fill(' ');
    await dialog.getByRole('button', { name: 'Submit review' }).click();
    await expect(answer).toBeFocused();
    await expect(answer).toHaveAttribute('aria-invalid', 'true');
    await expect(answer).toHaveAccessibleDescription('Enter an answer to this question.');
    await answer.fill('Fictional review draft from a production interaction check.');
    await expect(answer).not.toHaveAttribute('aria-invalid', 'true');
    await dialog.getByRole('button', { name: 'Save draft' }).click();
    await expect(dialog).toBeHidden();
    await employee.reload();
    await trigger.click();
    await expect(answer).toHaveValue('Fictional review draft from a production interaction check.');
    await dialog.getByRole('button', { name: 'Submit review' }).click();
    await expect(dialog).toBeHidden();
    await employee.reload();
    await expect(trigger.getByText(/^(submitted)$/i)).toBeVisible();
  } finally {
    await Promise.all([hr.close(), employee.close()]);
  }
}

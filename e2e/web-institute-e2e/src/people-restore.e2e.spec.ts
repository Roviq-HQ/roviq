/**
 * Delete → Deleted list → Restore for a guardian (ROV-84).
 *
 * Each test creates its own guardian, so it never touches seed records.
 */
import { expect, test } from '../../shared/console-guardian';
import { DeletedRecordsPanel } from './pages/DeletedRecordsPanel';
import { GuardianCreatePage } from './pages/GuardianCreatePage';

async function createGuardian(
  page: import('@playwright/test').Page,
): Promise<{ id: string; firstName: string }> {
  const firstName = `Restore ${Date.now()}`;
  const create = new GuardianCreatePage(page);
  await create.goto('en');
  await create.fillFirstNameEnglish(firstName);
  await create.submit();
  await create.expectRedirectedToDetail();
  const id = new URL(page.url()).pathname.split('/').pop() ?? '';
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  return { id, firstName };
}

test.describe('People — delete and restore', () => {
  test('a deleted guardian moves to Deleted guardians and comes back on restore', async ({
    page,
  }) => {
    const { id, firstName } = await createGuardian(page);
    const deleted = new DeletedRecordsPanel(page, 'guardian');

    await deleted.deleteFromDetail();
    await deleted.expectBackOnList();
    await expect(page.getByText(`${firstName} deleted`)).toBeVisible();
    await expect(page.getByRole('cell', { name: firstName })).toHaveCount(0);

    await deleted.open();
    await expect(deleted.row(id)).toContainText(firstName);

    await deleted.restore(id);
    await expect(page.getByText(`${firstName} restored`)).toBeVisible();
    await expect(deleted.row(id)).toHaveCount(0);

    // Survives a reload: the guardian is back in the directory.
    await deleted.gotoList();
    await expect(page.getByRole('cell', { name: firstName })).toBeVisible();
  });

  test('Undo on the delete toast restores the guardian', async ({ page }) => {
    const { id, firstName } = await createGuardian(page);
    const deleted = new DeletedRecordsPanel(page, 'guardian');

    await deleted.deleteFromDetail();
    await deleted.expectBackOnList();
    await deleted.undoButton().click();
    await expect(page.getByText(`${firstName} restored`)).toBeVisible();

    await deleted.open();
    await expect(deleted.row(id)).toHaveCount(0);
  });
});

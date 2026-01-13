import { test, expect } from '@playwright/test';

test.describe('LocalSync App Migration & Logic', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Clear DB to ensure fresh start (optional, but good for reliable tests)
    await page.evaluate(async () => {
      // Logic to clear Dexie if needed, but for E2E we might just rely on unique names
      const dbs = await window.indexedDB.databases();
      // We won't clear actual DB here to preserve user data, but we'll use unique task names
    });
  });

  test('should load dashboard and show main columns', async ({ page }) => {
    await expect(page).toHaveTitle('LocalSync');
    await expect(page.getByText('Today')).toBeVisible();
    await expect(page.getByText('In Progress')).toBeVisible();
    await expect(page.getByText('Done')).toBeVisible();
  });

  test('should support Focus Timer functionality (Fix Validation)', async ({ page }) => {
    const taskName = `Focus Test ${Date.now()}`;
    
    // 1. Create Task
    const fab = page.locator('button.fixed.bottom-8.right-8');
    await expect(fab).toBeVisible();
    await fab.click();
    
    await page.getByPlaceholder('What needs to be done?').fill(taskName);
    await page.getByPlaceholder('What needs to be done?').press('Enter');
    
    // 2. Locate Task Card
    const taskCard = page.locator('div', { hasText: taskName }).last();
    await expect(taskCard).toBeVisible();
    
    // HACK: Force opacity 1 on buttons to avoid hover issues in headless
    await page.evaluate(() => {
        document.querySelectorAll('.opacity-0').forEach(el => el.classList.remove('opacity-0'));
    });
    
    // 3. Click Focus Button
    // Now it should be visible
    const focusBtn = taskCard.getByTitle('Focus');
    await expect(focusBtn).toBeVisible();
    await focusBtn.click();
    
    // 4. Verify Banner Logic
    const banner = page.locator('h2', { hasText: taskName }).first();
    await expect(banner).toBeVisible({ timeout: 5000 });
    
    // 5. Verify Timer Countdown
    const timerDisplay = page.locator('p.font-mono');
    await expect(timerDisplay).toBeVisible();
    // Use regex to permit 25:00 or 24:59 immediately
    await expect(timerDisplay).toContainText(/25:00|24:59/);
    
    // Wait for 2 seconds
    await page.waitForTimeout(2000);
    const timeText = await timerDisplay.textContent();
    console.log(`Timer text after 2s: ${timeText}`);
    expect(timeText).not.toBe('25:00');
  });

  test('should manage Routines', async ({ page }) => {
    // 1. Go to Routines tab
    await page.getByRole('button', { name: 'routines' }).click();
    
    // 2. Add Routine
    await page.getByRole('button', { name: 'Add Routine' }).first().click();
    await page.getByPlaceholder('e.g. Morning Stretch').fill('Test Routine');
    const submitBtn = page.getByRole('button', { name: 'Add Routine' }).last(); 
    await submitBtn.click();
    
    // 3. Verify Routine
    await expect(page.getByText('Test Routine')).toBeVisible();
    
    // 4. Toggle Routine
    const routineCard = page.locator('div').filter({ hasText: 'Test Routine' }).first(); // use filter for robustness
    
    // Use title selector
    const toggleBtn = routineCard.getByTitle('Toggle Completion');
    await expect(toggleBtn).toBeVisible();
    await toggleBtn.click({ force: true });
    
    // Verify checked state
    // Check if it has the green background class 'bg-secondary'
    // We need to wait for class update
    await expect(toggleBtn).toHaveClass(/bg-secondary/);
  });
});

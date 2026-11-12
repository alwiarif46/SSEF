const { chromium } = require('playwright');
const { execSync } = require('child_process');
const B = process.env.BASE_URL ?? 'http://localhost:8080';
const out = process.env.SCREENSHOT_DIR ?? require('os').tmpdir();
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  const step = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { console.log('FAIL', name, e.message.split('\n')[0]); await page.screenshot({ path: `${out}/fail-${name}.png` }); throw e; } };

  await step('signup', async () => {
    await page.goto(B + '/signup');
    await page.getByLabel('Business / orchard name').fill('Mir Apple Orchards');
    await page.getByLabel('Your name').fill('Ali Mir');
    await page.getByLabel('Mobile number').fill('9419001234');
    await page.getByLabel('Password (min 8 characters)').fill('orchard-pass-1');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.getByText('Add an orchard with its location').waitFor();
  });
  await step('add orchard', async () => {
    await page.getByRole('link', { name: 'Add orchard' }).click();
    await page.getByLabel('Orchard name').fill('Shopian Upper');
    await page.getByLabel('Village').fill('Hirpora');
    await page.getByLabel('Latitude').fill('33.72');
    await page.getByLabel('Longitude').fill('74.83');
    await page.getByLabel('Elevation (m)').fill('2050');
    await page.getByLabel('Area (kanal)').fill('12');
    await page.getByRole('button', { name: 'Save orchard' }).click();
    await page.getByRole('heading', { name: 'Shopian Upper' }).waitFor();
  });
  await step('add block', async () => {
    await page.getByRole('button', { name: '+ Block' }).click();
    await page.getByLabel('Block name').fill('HDP-1');
    await page.getByRole('combobox', { name: /^System/ }).selectOption('hdp');
    await page.getByLabel('Planting year').fill('2021');
    await page.getByLabel('Number of trees').fill('1600');
    await page.getByLabel('Expected harvest').fill('2026-08-25');
    await page.getByRole('button', { name: 'Save block' }).click();
    await page.getByRole('tab', { name: 'Spray plan' }).waitFor();
  });
  await step('plan petal fall + record spray', async () => {
    await page.getByLabel('Spray date').fill('2026-04-28');
    await page.getByRole('combobox', { name: /^Stage/ }).selectOption('s06-petal-fall');
    await page.getByLabel('Tank size (litres)').fill('400');
    await page.getByText('Penconazole 10 EC').first().waitFor();
    await page.screenshot({ path: `${out}/03-plan.png`, fullPage: true });
    await page.getByRole('checkbox', { name: 'Select Penconazole 10 EC' }).check();
    await page.getByRole('button', { name: 'Record this spray →' }).click();
    await page.getByRole('dialog').waitFor();
    await page.screenshot({ path: `${out}/04-record.png` });
    await page.getByRole('button', { name: 'Save spray record' }).click();
    await page.getByText('Spray recorded and locked').waitFor();
  });
  await step('rotation blocks repeat', async () => {
    await page.getByLabel('Spray date').fill('2026-05-12');
    await page.getByRole('combobox', { name: /^Stage/ }).selectOption('s09-fd2');
    const opt = page.locator('label.opt', { hasText: 'Penconazole 10 EC' }).first();
    await opt.getByText('Blocked').waitFor();
    await opt.getByText(/never repeat a molecule/).waitFor();
  });
  await step('spray records tab', async () => {
    await page.getByRole('tab', { name: 'Spray records' }).click();
    await page.getByText('Penconazole 10 EC').first().waitFor();
  });
  await step('scouting', async () => {
    await page.getByRole('tab', { name: 'Scouting' }).click();
    await page.getByLabel(/^Count/).fill('25');
    await page.getByText('Above action threshold').waitFor();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText('Observation saved').waitFor();
  });
  await step('harvest maturity', async () => {
    await page.getByRole('tab', { name: 'Harvest' }).click();
    await page.getByLabel('Starch index (1–6)').fill('3.5');
    await page.getByLabel('TSS °Brix').fill('13');
    await page.getByLabel('Firmness (lb)').fill('17');
    await page.getByLabel('Boxes').fill('120');
    await page.getByLabel('Price per box (₹)').fill('950');
    await page.screenshot({ path: `${out}/05-harvest.png`, fullPage: true });
    await page.getByRole('button', { name: 'Save harvest' }).click();
    await page.getByText('Harvest recorded').waitFor();
  });
  execSync('node dist/worker.js --once', { cwd: require('path').resolve(__dirname, '../../api'), env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://orchard_app:orchard_app@localhost:5432/orchard' } });
  await step('dashboard with weather', async () => {
    await page.goto(B + '/');
    await page.getByRole('heading', { name: 'Today' }).waitFor();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${out}/01-dashboard.png`, fullPage: true });
  });
  await step('orchard weather chart', async () => {
    await page.getByRole('link', { name: 'Shopian Upper' }).first().click();
    await page.getByRole('tab', { name: 'Weather' }).click();
    await page.locator('.chart svg').first().waitFor();
    const box = await page.locator('.chart').boundingBox();
    await page.mouse.move(box.x + box.width * 0.4, box.y + 60);
    await page.screenshot({ path: `${out}/02-weather.png`, fullPage: true });
  });
  for (const [p, h] of [['/alerts', 'Alerts'], ['/tasks', 'Tasks'], ['/inventory', 'Chemical inventory'], ['/tank', 'Tank calculator'], ['/schedule', 'Spray schedule'], ['/chemicals', 'Chemical catalogue'], ['/reports', 'Reports'], ['/team', 'Team'], ['/settings', 'Settings & safety']])
    await step(`page ${p}`, async () => { await page.goto(B + p); await page.getByRole('heading', { name: h, exact: true }).waitFor(); if (['/schedule', '/reports', '/inventory'].includes(p)) await page.screenshot({ path: `${out}/page${p.replace('/', '-')}.png` }); });
  await step('reports numbers', async () => { await page.goto(B + '/reports'); await page.getByText('₹1,14,000').first().waitFor(); });
  await step('mobile + dark', async () => {
    const m = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
    m.on('pageerror', (e) => errors.push(String(e)));
    await m.goto(B + '/login');
    await m.getByLabel('Mobile number').fill('9419001234');
    await m.getByLabel('Password').fill('orchard-pass-1');
    await m.getByRole('button', { name: 'Sign in' }).click();
    await m.getByRole('heading', { name: 'Today' }).waitFor();
    await m.waitForTimeout(500);
    await m.screenshot({ path: `${out}/06-mobile-dark.png`, fullPage: true });
    const sw = await m.evaluate(() => document.documentElement.scrollWidth);
    if (sw > 392) throw new Error('horizontal overflow ' + sw);
  });
  console.log('console errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch(() => process.exit(1));

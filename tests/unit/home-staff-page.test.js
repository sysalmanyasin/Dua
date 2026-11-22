// @vitest-environment jsdom
// The Staff sections on Home (My Payroll, My Recent Activity), with the database mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../js/modules/home/data/api.js', () => ({ myPayslips: vi.fn(), myRecentClosings: vi.fn() }));
const api = await import('../../js/modules/home/data/api.js');
const { startStaffSections } = await import('../../js/modules/home/ui/staff.js');

const slip = (o = {}) => ({
  month: '2026-10-01',
  base_salary: 40000,
  days: 31,
  advance_deducted: 5000,
  incentive: 1200,
  other: [{ name: 'Eid bonus', sign: 1, amount: 700 }],
  net: 36900,
  ...o,
});
const closing = (o = {}) => ({
  closing_id: 'c1',
  business_date: '2026-11-21',
  kind: 'evening',
  status: 'submitted',
  revision: 1,
  submitted_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...o,
});

let payrollHost, activityHost, refresher;
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
};
const start = async (perms) => {
  refresher = startStaffSections({ payrollHost, activityHost, perms });
  await flush();
};

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="p"></div><div id="a"></div>';
  payrollHost = document.getElementById('p');
  activityHost = document.getElementById('a');
  api.myPayslips.mockReset();
  api.myRecentClosings.mockReset();
});
afterEach(() => {
  refresher?.stop();
  vi.useRealTimers();
});

describe('My payroll', () => {
  it('shows the latest closed payslip, read only', async () => {
    api.myPayslips.mockResolvedValue({ payslips: [slip(), slip({ month: '2026-09-01', net: 30000 })] });
    api.myRecentClosings.mockResolvedValue([]);
    await start(['payroll.view_own', 'closing.enter_own']);
    const t = payrollHost.textContent;
    expect(t).toContain('October 2026');
    expect(t).toContain('Rs 36,900');
    expect(t).toContain('Advance deducted');
    expect(t).toContain('Eid bonus');
    expect(t).toContain('Earlier months');
    expect(payrollHost.querySelectorAll('input, textarea, select, form')).toHaveLength(0);
    expect(payrollHost.textContent).toContain('cannot be changed here');
  });

  it('says plainly when no month has been closed yet', async () => {
    api.myPayslips.mockResolvedValue({ payslips: [] });
    await start(['payroll.view_own']);
    expect(payrollHost.textContent).toContain('No payslip yet');
  });

  it('does not ask for payroll, or show the section, without the permission', async () => {
    api.myRecentClosings.mockResolvedValue([]);
    await start(['closing.enter_own']);
    expect(api.myPayslips).not.toHaveBeenCalled();
    expect(payrollHost.querySelector('.ops-section')).toBeNull();
  });

  it('shows nothing if the database refuses (null)', async () => {
    api.myPayslips.mockResolvedValue(null);
    await start(['payroll.view_own']);
    expect(payrollHost.querySelector('.ops-section')).toBeNull();
  });

  it('keeps the last payslip and warns when a refresh fails', async () => {
    api.myPayslips.mockResolvedValueOnce({ payslips: [slip()] }).mockRejectedValue(new Error('offline'));
    await start(['payroll.view_own']);
    payrollHost.querySelector('[data-staff-refresh]').click();
    await flush();
    expect(payrollHost.textContent).toContain('Rs 36,900');
    expect(payrollHost.querySelector('.ops-status').textContent).toMatch(/out of date/);
  });
});

describe('My recent activity', () => {
  it("lists the person's own closings and whether each is finished", async () => {
    api.myRecentClosings.mockResolvedValue([
      closing(),
      closing({ closing_id: 'c2', status: 'draft', submitted_at: null, business_date: '2026-11-20' }),
    ]);
    await start(['closing.enter_own']);
    const t = activityHost.textContent;
    expect(t).toContain('Evening closing');
    expect(t).toContain('Submitted');
    expect(t).toContain('Draft saved, not yet submitted');
    expect(activityHost.querySelector('a').getAttribute('href')).toBe('#/closing');
  });

  it('explains an empty list', async () => {
    api.myRecentClosings.mockResolvedValue([]);
    await start(['closing.enter_own']);
    expect(activityHost.textContent).toContain('Nothing yet');
  });

  it('is not started at all for a person with neither permission', async () => {
    expect(startStaffSections({ payrollHost, activityHost, perms: ['sales.view_last_day'] })).toBeNull();
    expect(api.myPayslips).not.toHaveBeenCalled();
    expect(api.myRecentClosings).not.toHaveBeenCalled();
  });

  it('stops refreshing once the page is gone', async () => {
    api.myPayslips.mockResolvedValue({ payslips: [] });
    await start(['payroll.view_own']);
    document.body.innerHTML = '';
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(api.myPayslips).toHaveBeenCalledTimes(1);
  });
});

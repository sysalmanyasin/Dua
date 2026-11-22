// @vitest-environment jsdom
// The monthly Individual audit never offers "Start a new round": that call would send scope type 'individual', which
// stock refuses with an error the screen could only call "Something went wrong".
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../js/modules/audit/data/api.js', () => ({
  engagementOverview: vi.fn(),
  listPeopleForAudit: vi.fn(async () => []),
  createRound: vi.fn(),
  setMember: vi.fn(),
}));
const api = await import('../../js/modules/audit/data/api.js');
const { mount } = await import('../../js/modules/audit/ui/engagement.js');
const { setView } = await import('../../js/modules/audit/domain/nav.js');

const overview = (scope_type, over = {}) => ({
  engagement: {
    id: 'e1',
    name: 'Audit',
    scope_type,
    scope_companies: scope_type === 'selected' ? ['Acme', 'Beta'] : [],
    status: 'open',
    ...over,
  },
  members: [],
  rounds: [],
});
const ctx = { permissions: ['audit.manage'] };
const root = () => document.getElementById('root');
const text = () => root().textContent.replace(/\s+/g, ' ');

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  sessionStorage.clear();
  setView({ engagement: 'e1' });
  vi.clearAllMocks();
});

describe('audit page: starting a round', () => {
  it('offers the button for a full, selected or single audit', async () => {
    for (const type of ['full', 'selected', 'single']) {
      api.engagementOverview.mockResolvedValueOnce(overview(type));
      await mount(root(), { ctx });
      expect(root().querySelector('button[data-act="new-round"]'), type).not.toBeNull();
    }
  });

  it('does not offer it for the monthly Individual audit, says where rounds start, and labels the scope', async () => {
    api.engagementOverview.mockResolvedValueOnce(overview('individual'));
    await mount(root(), { ctx });
    expect(root().querySelector('button[data-act="new-round"]')).toBeNull();
    expect(root().querySelector('[data-no-new-round]').textContent).toContain('Individual page');
    expect(text()).toContain('Individual audits · Open');
  });

  it('never asks the database for a round in an Individual audit, even if the button were somehow clicked', async () => {
    api.engagementOverview.mockResolvedValueOnce(overview('individual'));
    await mount(root(), { ctx });
    const stray = document.createElement('button');
    stray.dataset.act = 'new-round';
    root().appendChild(stray);
    stray.click();
    await Promise.resolve();
    expect(api.createRound).not.toHaveBeenCalled();
    expect(text()).toContain('Individual page');
  });

  it('shows nothing about rounds to people who cannot manage', async () => {
    api.engagementOverview.mockResolvedValueOnce(overview('individual'));
    await mount(root(), { ctx: { permissions: ['audit.view'] } });
    expect(root().querySelector('[data-no-new-round]')).toBeNull();
  });
});

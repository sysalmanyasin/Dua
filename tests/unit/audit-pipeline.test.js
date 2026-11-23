// Where a round is on its road to Final, the next step, and what is waiting for a recompile (js/modules/audit/domain/pipeline.js).
import { describe, expect, it } from 'vitest';
import { STEPS, latestRound, nextStep, pipelineSteps, recompileNeeded } from '../../js/modules/audit/domain/pipeline.js';

const states = (round, extra = {}) => pipelineSteps({ round, ...extra }).map((s) => `${s.key}:${s.state}`);

describe('the five steps', () => {
  it('has them in order', () => {
    expect(STEPS.map((s) => s.key)).toEqual(['draft', 'locked', 'counting', 'compiled', 'final']);
  });

  it('marks what is done, what is now and what is still to come', () => {
    expect(states({ state: 'draft' })).toEqual(['draft:current', 'locked:todo', 'counting:todo', 'compiled:todo', 'final:todo']);
    expect(states({ state: 'counting' })).toEqual(['draft:done', 'locked:done', 'counting:current', 'compiled:todo', 'final:todo']);
    expect(states({ state: 'final' })).toEqual(['draft:done', 'locked:done', 'counting:done', 'compiled:done', 'final:done']);
  });

  it('says how many have submitted while counting, and how many differ once compiled', () => {
    const assignments = [{ status: 'submitted' }, { status: 'counting' }, { status: 'assigned' }];
    const counting = pipelineSteps({ round: { state: 'counting' }, assignments });
    expect(counting.find((s) => s.key === 'counting').detail).toBe('1 of 3 submitted');
    expect(counting.find((s) => s.key === 'compiled').detail).toBe('');
    const compiled = pipelineSteps({ round: { state: 'compiled' }, assignments, compilation: { variance_count: 4 } });
    expect(compiled.find((s) => s.key === 'compiled').detail).toBe('4 differ');
    expect(pipelineSteps({ round: { state: 'draft' }, assignments }).find((s) => s.key === 'counting').detail).toBe('');
  });

  it('shows a variance count of 0 as "0 differ", not as nothing', () => {
    const steps = pipelineSteps({ round: { state: 'compiled' }, compilation: { variance_count: 0 } });
    expect(steps.find((s) => s.key === 'compiled').detail).toBe('0 differ');
  });

  it('treats an unknown state as the start', () => {
    expect(states({ state: 'weird' })[0]).toBe('draft:current');
  });
});

describe('the next step', () => {
  const owner = ['audit.manage'];
  it('is the owner’s next move at each stage', () => {
    expect(nextStep('draft', owner)).toEqual({ label: 'Give out the work and lock the round', page: 'round' });
    expect(nextStep('locked', owner)).toEqual({ label: 'Start counting', page: 'round' });
    expect(nextStep('counting', owner)).toEqual({ label: 'Review the counting', page: 'compile' });
    expect(nextStep('compiled', owner)).toEqual({ label: 'Review and finish', page: 'compile' });
    expect(nextStep('final', owner)).toEqual({ label: 'See the final result', page: 'final' });
    expect(nextStep('mystery', owner)).toBeNull();
  });

  it('offers only what the person’s keys allow', () => {
    expect(nextStep('draft', ['audit.assign'])).not.toBeNull();
    expect(nextStep('locked', ['audit.assign'])).toBeNull(); // starting needs the owner
    expect(nextStep('counting', ['audit.review'])).not.toBeNull();
    expect(nextStep('counting', ['audit.view'])).toBeNull();
    expect(nextStep('compiled', [])).toBeNull();
    expect(nextStep('final', [])).not.toBeNull(); // anyone who can open the round can read its result
  });
});

describe('the newest round', () => {
  it('is the highest number, then the later letter', () => {
    const rounds = [
      { id: 'a', round_number: 1, round_suffix: null },
      { id: 'c', round_number: 1, round_suffix: 'B' },
      { id: 'b', round_number: 1, round_suffix: 'A' },
    ];
    expect(latestRound(rounds).id).toBe('c');
    expect(latestRound([...rounds, { id: 'd', round_number: 2, round_suffix: null }]).id).toBe('d');
    expect(latestRound([])).toBeUndefined();
  });
});

describe('what is waiting for a recompile', () => {
  const compilation = { compiled_at: '2026-11-17T08:00:00Z', missing_assignment_ids: [] };
  const round = { state: 'compiled' };
  const base = { round, compilation, assignments: [{ id: 'a1', name: 'One', status: 'submitted' }], corrections: [] };

  it('is null when nothing changed since the compile', () => {
    expect(recompileNeeded(base)).toBeNull();
    expect(recompileNeeded({ ...base, round: { state: 'counting' } })).toBeNull();
    expect(recompileNeeded({ ...base, compilation: null })).toBeNull();
  });

  it('counts approved corrections decided after the compile, and not earlier, proposed or rejected ones', () => {
    const corrections = [
      { status: 'approved', decided_at: '2026-11-17T09:00:00Z' },
      { status: 'approved', decided_at: '2026-11-17T09:30:00Z' },
      { status: 'approved', decided_at: '2026-11-17T07:00:00Z' }, // already in the compile
      { status: 'proposed', decided_at: null },
      { status: 'rejected', decided_at: '2026-11-17T09:00:00Z' },
    ];
    const need = recompileNeeded({ ...base, corrections });
    expect(need).toMatchObject({ approved: 2, text: '2 approved corrections waiting', ready: true, allowMissing: false });
    expect(recompileNeeded({ ...base, corrections: [corrections[0]] }).text).toBe('1 approved correction waiting');
  });

  it('a count that was reopened and not submitted again must wait; recompiling now would leave it out', () => {
    const need = recompileNeeded({ ...base, assignments: [{ id: 'a1', name: 'One', status: 'counting' }] });
    expect(need.ready).toBe(false);
    expect(need.reopened).toEqual(['One']);
    expect(need.text).toBe('One reopened and not submitted again');
  });

  it('a count that was missing at the compile and has been submitted since is waiting too', () => {
    const need = recompileNeeded({
      ...base,
      compilation: { ...compilation, missing_assignment_ids: ['a1'] },
      assignments: [{ id: 'a1', name: 'One', status: 'submitted' }],
    });
    expect(need).toMatchObject({ late: 1, ready: true, text: '1 count submitted since the compile' });
  });

  it('someone who was missing at the compile and still has not submitted is not "reopened", and allows an incomplete compile', () => {
    const need = recompileNeeded({
      ...base,
      compilation: { ...compilation, missing_assignment_ids: ['a2'] },
      assignments: [
        { id: 'a1', name: 'One', status: 'submitted' },
        { id: 'a2', name: 'Two', status: 'counting' },
      ],
      corrections: [{ status: 'approved', decided_at: '2026-11-17T09:00:00Z' }],
    });
    expect(need).toMatchObject({ ready: true, reopened: [], allowMissing: true });
  });

  it('joins what is waiting into one line', () => {
    const need = recompileNeeded({
      ...base,
      assignments: [{ id: 'a1', name: 'One', status: 'counting' }],
      corrections: [{ status: 'approved', decided_at: '2026-11-17T09:00:00Z' }],
    });
    expect(need.text).toBe('1 approved correction waiting · One reopened and not submitted again');
  });
});

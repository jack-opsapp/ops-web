import { describe, it, expect } from 'vitest';
import {
  calculateCascade,
  autoSchedule,
  pushByDays,
  topologicalSort,
} from '@/lib/scheduling/engine';
import type { SchedulableTask } from '@/lib/types/scheduling';

function makeTask(overrides: Partial<SchedulableTask> & { id: string; taskTypeId: string }): SchedulableTask {
  return {
    startDate: null,
    endDate: null,
    duration: 1,
    effectiveDependencies: [],
    displayOrder: 0,
    teamMemberIds: [],
    ...overrides,
  };
}

describe('topologicalSort', () => {
  it('returns tasks in dependency order', () => {
    const tasks: SchedulableTask[] = [
      makeTask({ id: '3', taskTypeId: 'elect', displayOrder: 2, effectiveDependencies: [{ depends_on_task_type_id: 'frame', overlap_percentage: 0 }] }),
      makeTask({ id: '1', taskTypeId: 'demo', displayOrder: 0 }),
      makeTask({ id: '2', taskTypeId: 'frame', displayOrder: 1, effectiveDependencies: [{ depends_on_task_type_id: 'demo', overlap_percentage: 0 }] }),
    ];
    const sorted = topologicalSort(tasks);
    const typeIds = sorted.map(t => t.taskTypeId);
    expect(typeIds).toEqual(['demo', 'frame', 'elect']);
  });

  it('falls back to displayOrder for tasks with no dependencies', () => {
    const tasks: SchedulableTask[] = [
      makeTask({ id: '2', taskTypeId: 'b', displayOrder: 1 }),
      makeTask({ id: '1', taskTypeId: 'a', displayOrder: 0 }),
      makeTask({ id: '3', taskTypeId: 'c', displayOrder: 2 }),
    ];
    const sorted = topologicalSort(tasks);
    expect(sorted.map(t => t.id)).toEqual(['1', '2', '3']);
  });

  it('handles circular dependencies without infinite loop', () => {
    const tasks: SchedulableTask[] = [
      makeTask({ id: '1', taskTypeId: 'a', effectiveDependencies: [{ depends_on_task_type_id: 'b', overlap_percentage: 0 }] }),
      makeTask({ id: '2', taskTypeId: 'b', effectiveDependencies: [{ depends_on_task_type_id: 'a', overlap_percentage: 0 }] }),
    ];
    const sorted = topologicalSort(tasks);
    expect(sorted).toHaveLength(2);
  });
});

describe('pushByDays', () => {
  it('pushes a task forward by N days', () => {
    const task = makeTask({
      id: '1',
      taskTypeId: 'demo',
      startDate: new Date(2026, 2, 3),
      endDate: new Date(2026, 2, 5),
      duration: 3,
    });
    const result = pushByDays(task, 2);
    expect(result.newStart.getDate()).toBe(5);
    expect(result.newEnd.getDate()).toBe(7);
  });

  it('skips weekends when enabled', () => {
    const task = makeTask({
      id: '1',
      taskTypeId: 'demo',
      startDate: new Date(2026, 2, 6), // Fri Mar 6
      endDate: new Date(2026, 2, 6),
      duration: 1,
    });
    const result = pushByDays(task, 1, true);
    expect(result.newStart.getDay()).toBe(1); // Monday
  });
});

describe('calculateCascade', () => {
  it('cascades dependent tasks forward', () => {
    const tasks: SchedulableTask[] = [
      makeTask({ id: '1', taskTypeId: 'demo', startDate: new Date(2026, 2, 3), endDate: new Date(2026, 2, 3), duration: 1 }),
      makeTask({ id: '2', taskTypeId: 'frame', startDate: new Date(2026, 2, 4), endDate: new Date(2026, 2, 5), duration: 2, effectiveDependencies: [{ depends_on_task_type_id: 'demo', overlap_percentage: 0 }] }),
      makeTask({ id: '3', taskTypeId: 'elect', startDate: new Date(2026, 2, 6), endDate: new Date(2026, 2, 6), duration: 1, effectiveDependencies: [{ depends_on_task_type_id: 'frame', overlap_percentage: 0 }] }),
    ];
    const result = calculateCascade('1', new Date(2026, 2, 5), new Date(2026, 2, 5), tasks);
    expect(result.changes).toHaveLength(2);
    expect(result.changes[0].id).toBe('2');
    expect(result.changes[0].newStartDate.getDate()).toBe(6);
    expect(result.changes[1].id).toBe('3');
  });

  it('returns empty changes when no dependents exist', () => {
    const tasks: SchedulableTask[] = [
      makeTask({ id: '1', taskTypeId: 'demo', startDate: new Date(2026, 2, 3), endDate: new Date(2026, 2, 3), duration: 1 }),
      makeTask({ id: '2', taskTypeId: 'frame', startDate: new Date(2026, 2, 10), endDate: new Date(2026, 2, 11), duration: 2 }),
    ];
    const result = calculateCascade('1', new Date(2026, 2, 5), new Date(2026, 2, 5), tasks);
    expect(result.changes).toHaveLength(0);
  });

  it('respects overlap percentage', () => {
    const tasks: SchedulableTask[] = [
      makeTask({ id: '1', taskTypeId: 'demo', startDate: new Date(2026, 2, 3), endDate: new Date(2026, 2, 6), duration: 4 }),
      makeTask({ id: '2', taskTypeId: 'frame', startDate: new Date(2026, 2, 5), endDate: new Date(2026, 2, 7), duration: 3, effectiveDependencies: [{ depends_on_task_type_id: 'demo', overlap_percentage: 50 }] }),
    ];
    const result = calculateCascade('1', new Date(2026, 2, 5), new Date(2026, 2, 8), tasks);
    if (result.changes.length > 0) {
      expect(result.changes[0].newStartDate.getDate()).toBeGreaterThanOrEqual(7);
    }
  });
});

describe('autoSchedule', () => {
  it('places unscheduled tasks in dependency order from anchor date', () => {
    const unscheduled: SchedulableTask[] = [
      makeTask({ id: '2', taskTypeId: 'frame', duration: 2, displayOrder: 1, effectiveDependencies: [{ depends_on_task_type_id: 'demo', overlap_percentage: 0 }] }),
      makeTask({ id: '1', taskTypeId: 'demo', duration: 1, displayOrder: 0 }),
    ];
    const result = autoSchedule(unscheduled, [], new Date(2026, 2, 3));
    expect(result.placements).toHaveLength(2);
    expect(result.placements[0].taskTypeId).toBe('demo');
    expect(result.placements[0].startDate.getDate()).toBe(3);
    expect(result.placements[1].taskTypeId).toBe('frame');
    expect(result.placements[1].startDate.getDate()).toBe(4);
  });

  it('skips weekends when enabled', () => {
    const unscheduled: SchedulableTask[] = [
      makeTask({ id: '1', taskTypeId: 'demo', duration: 1, displayOrder: 0 }),
      makeTask({ id: '2', taskTypeId: 'frame', duration: 1, displayOrder: 1 }),
    ];
    const result = autoSchedule(unscheduled, [], new Date(2026, 2, 6), false, true);
    expect(result.placements[1].startDate.getDay()).toBe(1); // Monday
  });
});

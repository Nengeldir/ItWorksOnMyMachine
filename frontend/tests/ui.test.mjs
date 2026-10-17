import assert from 'node:assert/strict';
import test from 'node:test';
import { breakpoint, gridMove, nextFocus, sheetDismissed, sheetPlacement, tabStep, wedgeAt, wedgeDirection } from '../src/components/ui/nav.ts';
import { DRAG, DragTracker, sameSlot } from '../src/components/ui/dnd.ts';
import { ToastQueue } from '../src/components/ui/toastQueue.ts';
import { counterAt, holdProgress } from '../src/components/ui/motion.ts';

// The UI primitives' logic (plan F7): breakpoints, the grid's keyboard model, spatial focus for the
// gamepad, the radial menu's wedges, dragging, the toast queue, the hold ring and the counter.

test('breakpoints follow plan §5, short winning over width', () => {
  assert.equal(breakpoint(1280, 720), 'wide');
  assert.equal(breakpoint(1100, 800), 'wide');
  assert.equal(breakpoint(1024, 768), 'medium');
  assert.equal(breakpoint(760, 900), 'medium');
  assert.equal(breakpoint(390, 760), 'compact');
  assert.equal(breakpoint(844, 390), 'short');
  assert.equal(breakpoint(1600, 470), 'short');
});

test('sheets go to the side on wide, the centre on medium, the bottom on phones', () => {
  assert.equal(sheetPlacement('wide'), 'side');
  assert.equal(sheetPlacement('medium'), 'centre');
  assert.equal(sheetPlacement('compact'), 'bottom');
  assert.equal(sheetPlacement('short'), 'bottom');
  // Asked for, kept where it fits; a side sheet on a phone becomes the bottom sheet
  assert.equal(sheetPlacement('wide', 'centre'), 'centre');
  assert.equal(sheetPlacement('short', 'side'), 'bottom');
  assert.equal(sheetPlacement('medium', 'side'), 'side');
});

test('a bottom sheet closes past a distance or on a flick, not on a nudge', () => {
  assert.equal(sheetDismissed(20, 0.1), false);
  assert.equal(sheetDismissed(120, 0.1), true);
  assert.equal(sheetDismissed(40, 1.2), true);
  assert.equal(sheetDismissed(10, 3), false);
});

test('the grid keyboard model: rows run on sideways, columns stop at the edges', () => {
  // 10 slots, 4 wide:  0 1 2 3 / 4 5 6 7 / 8 9
  assert.equal(gridMove(3, 'ArrowRight', 4, 10), 4);
  assert.equal(gridMove(4, 'ArrowLeft', 4, 10), 3);
  assert.equal(gridMove(0, 'ArrowLeft', 4, 10), 0);
  assert.equal(gridMove(9, 'ArrowRight', 4, 10), 9);
  assert.equal(gridMove(1, 'ArrowUp', 4, 10), 1, 'top edge: unused, handed on');
  assert.equal(gridMove(5, 'ArrowDown', 4, 10), 9);
  assert.equal(gridMove(7, 'ArrowDown', 4, 10), 9, 'below a short last row: its last slot');
  assert.equal(gridMove(9, 'ArrowDown', 4, 10), 9, 'bottom edge');
  assert.equal(gridMove(6, 'Home', 4, 10), 4);
  assert.equal(gridMove(5, 'End', 4, 10), 7);
  assert.equal(gridMove(9, 'End', 4, 10), 9);
  assert.equal(gridMove(9, 'PageUp', 4, 10), 1);
  assert.equal(gridMove(1, 'PageDown', 4, 10), 9);
  assert.equal(gridMove(2, 'PageDown', 4, 10), 6, 'column without a last-row slot');
  assert.equal(gridMove(0, 'ArrowDown', 4, 0), -1);
});

test('every slot of a grid is reachable by arrows, and moves stay in range', () => {
  for (const [columns, count] of [[9, 36], [6, 27], [4, 10], [1, 5], [7, 7]]) {
    const seen = new Set([0]);
    const queue = [0];
    while (queue.length) {
      const at = queue.pop();
      for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']) {
        const next = gridMove(at, key, columns, count);
        assert.ok(next >= 0 && next < count, `${columns}x${count} ${at} ${key}`);
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    assert.equal(seen.size, count);
  }
});

test('spatial focus picks the nearest box that way, preferring the straight line', () => {
  const box = (x, y) => ({ x, y, width: 40, height: 40 });
  //   [0]      [1]
  //   [2] [3]
  const boxes = [box(0, 0), box(200, 0), box(0, 100), box(60, 100)];
  assert.equal(nextFocus(boxes, 0, 'right'), 1);
  assert.equal(nextFocus(boxes, 0, 'down'), 2);
  assert.equal(nextFocus(boxes, 2, 'right'), 3);
  assert.equal(nextFocus(boxes, 3, 'up'), 0);
  assert.equal(nextFocus(boxes, 1, 'right'), -1);
  assert.equal(nextFocus(boxes, 1, 'down'), 3);
  assert.equal(nextFocus(boxes, -1, 'down'), 0, 'nothing focused: the first');
  assert.equal(nextFocus([], -1, 'down'), -1);
});

test('radial wedges: the first straight up, clockwise, none in the dead zone', () => {
  assert.equal(wedgeAt(0, -10, 4), 0);
  assert.equal(wedgeAt(10, 0, 4), 1);
  assert.equal(wedgeAt(0, 10, 4), 2);
  assert.equal(wedgeAt(-10, 0, 4), 3);
  assert.equal(wedgeAt(7, -7, 8), 1);
  assert.equal(wedgeAt(-7, -7, 8), 7);
  assert.equal(wedgeAt(1, 1, 8, 5), -1);
  // Every wedge's own direction lands in it
  for (const n of [4, 5, 6, 7, 8]) {
    for (let i = 0; i < n; i++) {
      const d = wedgeDirection(i, n);
      assert.equal(wedgeAt(d.x * 50, d.y * 50, n, 10), i, `${i}/${n}`);
    }
  }
});

test('a mouse drags after a few pixels; a finger has to rest first', () => {
  const mouse = new DragTracker();
  mouse.down('mouse', 0, 0, 0);
  assert.equal(mouse.move(3, 0, 10), false);
  assert.equal(mouse.move(DRAG.mouseSlop + 1, 0, 20), true);
  assert.equal(mouse.up(), 'drop');

  const click = new DragTracker();
  click.down('mouse', 0, 0, 0);
  click.move(2, 2, 50);
  assert.equal(click.up(), 'tap');

  const scroll = new DragTracker();
  scroll.down('touch', 0, 0, 0);
  scroll.move(0, DRAG.touchSlop + 5, 80);
  assert.equal(scroll.phase, 'idle', 'a finger moving at once is scrolling');
  assert.equal(scroll.tick(DRAG.longPress + 10), false);
  assert.equal(scroll.up(), 'cancel');

  const rest = new DragTracker();
  rest.down('touch', 0, 0, 0);
  rest.move(3, 3, 100);
  assert.equal(rest.tick(DRAG.longPress - 1), false);
  assert.equal(rest.tick(DRAG.longPress + 1), true);
  rest.move(120, 40, 600);
  assert.equal(rest.up(), 'drop');

  const tap = new DragTracker();
  tap.down('touch', 0, 0, 0);
  assert.equal(tap.up(), 'tap');
  assert.ok(sameSlot({ grid: 'bag', index: 2 }, { grid: 'bag', index: 2 }));
  assert.ok(!sameSlot({ grid: 'bag', index: 2 }, { grid: 'storage', index: 2 }));
});

test('toasts: three at a time, repeats count up, the rest wait their turn', () => {
  const q = new ToastQueue(3);
  q.push({ text: 'a', duration: 1000 }, 0);
  q.push({ text: 'b', duration: 1000 }, 0);
  q.push({ text: 'c', duration: 1000 }, 0);
  q.push({ text: 'd', duration: 1000 }, 0);
  assert.deepEqual(q.showing().map((t) => t.text), ['a', 'b', 'c']);
  q.push({ text: 'Bag full', key: 'full', duration: 1000 }, 100);
  q.push({ text: 'b', duration: 1000 }, 500);
  assert.equal(q.showing().find((t) => t.text === 'b').count, 2);
  assert.equal(q.nextExpiry(500), 500);
  q.update(1000);
  // a and c ran out; b was refreshed at 500; d and the bag note came in, in order
  assert.deepEqual(q.showing().map((t) => t.text), ['b', 'd', 'Bag full']);
  q.update(5000);
  assert.equal(q.showing().length, 0);
  assert.equal(q.nextExpiry(5000), Infinity);
});

test('the hold ring fills over its time and drains twice as fast', () => {
  let p = 0;
  for (let i = 0; i < 9; i++) p = holdProgress(p, true, 0.1, 1);
  assert.ok(Math.abs(p - 0.9) < 1e-9);
  p = holdProgress(p, true, 0.2, 1);
  assert.equal(p, 1);
  p = holdProgress(p, false, 0.25, 1);
  assert.ok(Math.abs(p - 0.5) < 1e-9);
  assert.equal(holdProgress(0.1, false, 1, 1), 0);
});

test('the counter rolls whole numbers, eased, and lands exactly', () => {
  assert.equal(counterAt(0, 100, 0, 600), 0);
  assert.equal(counterAt(0, 100, 600, 600), 100);
  assert.equal(counterAt(0, 100, 900, 600), 100);
  const half = counterAt(0, 100, 300, 600);
  assert.ok(half > 50 && half < 100, 'eased out: past halfway at half time');
  assert.ok(Number.isInteger(counterAt(3, 1234567, 123, 600)));
  assert.equal(counterAt(500, 20, 600, 600), 20, 'down too');
});

test('tabs step round', () => {
  const tabs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.equal(tabStep(tabs, 'a', 1), 'b');
  assert.equal(tabStep(tabs, 'c', 1), 'a');
  assert.equal(tabStep(tabs, 'a', -1), 'c');
});

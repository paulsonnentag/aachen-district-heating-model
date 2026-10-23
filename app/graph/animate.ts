import { createSignal, on, onCleanup, createEffect, type Accessor } from 'solid-js';
import type { Box, Layout } from './layout';

export type ShownBox = Box & { opacity: number };
export type ShownLayout = { boxes: Map<string, ShownBox>; width: number; height: number; moving: boolean };

const DURATION = 260;

/**
 * Follows `target`, easing every box from where it is on screen to where it goes. Boxes that appear
 * slide out of the `anchor` box (or grow from their `twin` that leaves, e.g. a group box opening into
 * its frame) and fade in, unless they should appear `inPlace`; boxes that go slide into it and fade
 * out, staying drawn until they are gone.
 */
export function animateLayout(
  target: Accessor<Layout>,
  anchor: Accessor<string | undefined>,
  twin: (id: string) => string | undefined,
  inPlace: (id: string) => boolean,
): Accessor<ShownLayout> {
  const [shown, setShown] = createSignal(still(target()));
  let request = 0;
  createEffect(
    on(
      target,
      (next) => {
        cancelAnimationFrame(request);
        const from = shown();
        if (reducedMotion()) return setShown(still(next));
        const key = anchor();
        const origin = key === undefined ? undefined : (from.boxes.get(key) ?? next.boxes.get(key));
        const destination = key === undefined ? undefined : (next.boxes.get(key) ?? from.boxes.get(key));
        const tracks = new Map<string, [ShownBox, ShownBox]>();
        for (const [id, box] of next.boxes) {
          const end = { ...box, opacity: 1 };
          const current = from.boxes.get(id);
          const pair = twin(id);
          const grown = pair !== undefined && !next.boxes.has(pair) ? from.boxes.get(pair) : undefined;
          const start = current ?? (grown ? { ...grown, opacity: 1 } : { ...centredIn(box, inPlace(id) ? undefined : origin), opacity: 0 });
          tracks.set(id, [start, end]);
        }
        for (const [id, box] of from.boxes) {
          if (next.boxes.has(id)) continue;
          const pair = twin(id);
          const shrunk = pair !== undefined && !from.boxes.has(pair) ? next.boxes.get(pair) : undefined;
          if (shrunk) continue;
          tracks.set(id, [box, { ...centredIn(box, destination), opacity: 0 }]);
        }
        const width = Math.max(from.width, next.width);
        const height = Math.max(from.height, next.height);
        const started = performance.now();
        const step = (now: number) => {
          const t = Math.min(1, Math.max(0, (now - started) / DURATION));
          if (t === 1) return setShown(still(next));
          const eased = 1 - (1 - t) ** 3;
          const boxes = new Map([...tracks].map(([id, [a, b]]) => [id, mix(a, b, eased)]));
          setShown({ boxes, width, height, moving: true });
          request = requestAnimationFrame(step);
        };
        step(started);
      },
      { defer: true },
    ),
  );
  onCleanup(() => cancelAnimationFrame(request));
  return shown;
}

function still(layout: Layout): ShownLayout {
  const boxes = new Map([...layout.boxes].map(([id, box]) => [id, { ...box, opacity: 1 }]));
  return { boxes, width: layout.width, height: layout.height, moving: false };
}

/** The box moved so its centre is on `anchor`'s centre; unmoved without an anchor. */
function centredIn(box: Box, anchor: Box | undefined): Box {
  if (!anchor) return box;
  return { ...box, x: anchor.x + (anchor.width - box.width) / 2, y: anchor.y + (anchor.height - box.height) / 2 };
}

function mix(a: ShownBox, b: ShownBox, t: number): ShownBox {
  const at = (from: number, to: number) => from + (to - from) * t;
  return { x: at(a.x, b.x), y: at(a.y, b.y), width: at(a.width, b.width), height: at(a.height, b.height), opacity: at(a.opacity, b.opacity) };
}

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

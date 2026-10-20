import { createEffect, onCleanup } from 'solid-js';

/** Mounts whatever DOM node `render` returns and re-renders when its reactive inputs change. */
export function Plot(props: { render: () => Element; class?: string }) {
  let container!: HTMLDivElement;
  createEffect(() => {
    const element = props.render();
    container.replaceChildren(element);
    onCleanup(() => element.remove());
  });
  return <div ref={container} class={props.class} />;
}

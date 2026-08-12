// WHY: `position: fixed` does not always mean "fixed to the window". Any
// ancestor with a transform, a filter, a backdrop-filter or `will-change` on one
// of those becomes the containing block for its fixed descendants, and this app
// has several: cards animate in, panels use `backdrop-filter: blur(16px)` for
// the frosted look, and the page itself slides sideways to make room for the
// chat drawer.
//
// The drawer was one of those descendants. It measured 2,323px tall — the height
// of the card it happened to sit inside — starting 1,709px above the top of the
// window. That is what "the chat box is super long and the top is miles from the
// text box" was.
//
// No stylesheet can fix that from inside, because the rule is about where the
// element IS, not how it is styled. So it moves: this renders its children into
// a container attached straight to <body>, where nothing is between it and the
// window. Preact's own `createPortal` lives in preact/compat, which this app
// does not vendor (no build step, D001), and the whole of it for our purposes is
// the twelve lines below.
import { render, useRef, useEffect } from '../vendor/ui.js';

/**
 * Render children at the end of <body>, wherever this sits in the tree.
 *
 * Only for things that cover the window: drawers, modals, their scrims. Events
 * inside a portal do NOT bubble to the React-ish parent — this is a real
 * separate render root — so anything portalled must take what it needs as
 * props, which is how the drawer already worked.
 *
 * @param {object} props
 * @param {*} props.children
 */
export function Portal({ children }) {
  const host = useRef(null);
  // Made during render rather than in the effect, so the first effect below has
  // something to append and the second has somewhere to draw.
  if (host.current === null) {
    host.current = document.createElement('div');
    host.current.className = 'portal';
  }

  useEffect(() => {
    const node = host.current;
    document.body.appendChild(node);
    // Unmounting has to tear down the inner root as well as detach the node, or
    // its effects — key handlers on window, the class on <body> — keep running
    // against a component nobody can see.
    return () => {
      render(null, node);
      node.remove();
    };
  }, []);

  // No dependency list on purpose: `children` is a fresh tree on every parent
  // render, and this root only updates when it is redrawn.
  useEffect(() => {
    render(children, host.current);
  });

  return null;
}

export default Portal;

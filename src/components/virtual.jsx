// Virtualization helpers — render only items in the visible viewport.
// Auto-detects the nearest scrolling ancestor; no extra wiring needed.
//

// VirtualList: fixed-row-height list/table.

(function () {
  const { useRef, useState, useEffect, useLayoutEffect } = React;

  function findScrollParent(el) {
    let p = el && el.parentElement;
    while (p && p !== document.body) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll|overlay)/.test(cs.overflowY + cs.overflow)) return p;
      p = p.parentElement;
    }
    return window;
  }

  function useScrollViewport(containerRef) {
    const [state, setState] = useState({ scrollTop: 0, viewportH: 800, offset: 0 });
    const scrollerRef = useRef(null);

    const measure = () => {
      const el = containerRef.current;
      if (!el) return;
      const sc = scrollerRef.current;
      if (!sc) return;
      const isWin = sc === window;
      const cRect = el.getBoundingClientRect();
      const sRect = isWin ? { top: 0 } : sc.getBoundingClientRect();
      const scrollTop = isWin ? window.scrollY : sc.scrollTop;
      const viewportH = isWin ? window.innerHeight : sc.clientHeight;
      // container's top in the scroller's content space
      const offset = (cRect.top - sRect.top) + scrollTop;
      setState({ scrollTop, viewportH, offset });
    };

    useLayoutEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const sc = findScrollParent(el);
      scrollerRef.current = sc;
      const onScroll = () => measure();
      const onResize = () => measure();
      sc.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onResize);
      measure();
      // Re-measure shortly after mount in case layout settles late (fonts, etc.)
      const t = setTimeout(measure, 50);
      return () => {
        clearTimeout(t);
        sc.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onResize);
      };
    }, []);

    return { ...state, remeasure: measure };
  }


  window.VirtualList = function VirtualList({
    items,
    renderItem,
    rowHeight,
    overscan = 6,
    className = '',
    style = {},
    keyOf,
  }) {
    const containerRef = useRef(null);
    const { scrollTop, viewportH, offset, remeasure } = useScrollViewport(containerRef);

    const total = items ? items.length : 0;
    const totalHeight = total * rowHeight;
    const localScroll = Math.max(0, scrollTop - offset);
    const startIdx = Math.max(0, Math.floor(localScroll / rowHeight) - overscan);
    const endIdx = Math.min(total, Math.ceil((localScroll + viewportH) / rowHeight) + overscan);

    useEffect(() => { remeasure(); }, [total]);

    const visible = [];
    for (let i = startIdx; i < endIdx; i++) visible.push({ item: items[i], idx: i });

    return (
      <div ref={containerRef} className={className} style={{ position: 'relative', width: '100%', height: totalHeight, ...style }}>
        {visible.map(({ item, idx }) => (
          <div key={keyOf ? keyOf(item, idx) : idx} style={{
            position: 'absolute',
            top: idx * rowHeight,
            left: 0,
            right: 0,
            height: rowHeight,
          }}>
            {renderItem(item, idx)}
          </div>
        ))}
      </div>
    );
  };

  Object.assign(window, { VirtualList: window.VirtualList });
})();

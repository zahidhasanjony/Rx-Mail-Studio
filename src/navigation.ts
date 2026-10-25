import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';

// Each screen owns one key; a history entry captures all keys and scroll positions.
function saveScroll() {
  const main = document.querySelector('main');
  history.replaceState({ ...history.state, rxScroll: [window.scrollY, main?.scrollTop || 0] }, '');
}
export function useNavigationState<T>(key: string, initial: T | (() => T), push = true) {
  const fallback = useRef<T>(typeof initial === 'function' ? (initial as () => T)() : initial);
  const [value, update] = useState<T>(() => history.state?.rxNavigation?.[key] ?? fallback.current);
  const current = useRef(value); current.current = value;
  useEffect(() => {
    history.replaceState({ ...history.state, rxNavigation: { ...history.state?.rxNavigation, [key]: current.current } }, '');
    const restore = () => {
      update(history.state?.rxNavigation?.[key] ?? fallback.current);
      const scroll = history.state?.rxScroll;
      if (scroll) requestAnimationFrame(() => { window.scrollTo?.(0, scroll[0]); const main = document.querySelector('main'); if (main) main.scrollTop = scroll[1]; });
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [key]);
  const set = useCallback((next: SetStateAction<T>, replace = !push) => {
    const resolved = typeof next === 'function' ? (next as (v: T) => T)(current.current) : next;
    if (JSON.stringify(resolved) === JSON.stringify(current.current)) return;
    saveScroll();
    const reuseClosedModal=history.state?.rxClosedModal;
    const state = { ...history.state, rxClosedModal:false, rxNavigation: { ...history.state?.rxNavigation, [key]: resolved } };
    history[replace || reuseClosedModal ? 'replaceState' : 'pushState'](state, '');
    current.current = resolved; update(resolved);
  }, [key, push]);
  return [value, set] as const;
}

export function useSidebarGesture(open: boolean, setOpen: (value: boolean) => void) {
  useEffect(() => {
    let start: { x: number; y: number } | null = null;
    const begin = (event: TouchEvent) => {
      if (event.touches.length !== 1 || window.innerWidth > 900) return;
      const t = event.touches[0];
      start = open || t.clientX <= 28 ? { x: t.clientX, y: t.clientY } : null;
    };
    const end = (event: TouchEvent) => {
      if (!start || !event.changedTouches.length) return;
      const t = event.changedTouches[0], dx = t.clientX - start.x, dy = t.clientY - start.y;
      if (Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy) * 1.7) {
        if (!open && dx > 0) setOpen(true);
        if (open && dx < 0) setOpen(false);
      }
      start = null;
    };
    document.addEventListener('touchstart', begin, { passive: true });
    document.addEventListener('touchend', end, { passive: true });
    return () => { document.removeEventListener('touchstart', begin); document.removeEventListener('touchend', end); };
  }, [open, setOpen]);
}

export function useModalHistory(onClose: () => void) {
  const close=useRef(onClose);close.current=onClose;
  const marker=useRef('');
  useEffect(()=>{
    const id=crypto.randomUUID();marker.current=id;
    saveScroll();history.pushState({...history.state,rxModal:id},'');
    const back=()=>{if(history.state?.rxModal!==id)close.current();};
    window.addEventListener('popstate',back);
    return()=>{window.removeEventListener('popstate',back);if(history.state?.rxModal===id){const {rxModal,...state}=history.state;history.replaceState({...state,rxClosedModal:true},'');}};
  },[]);
  return ()=>close.current();
}

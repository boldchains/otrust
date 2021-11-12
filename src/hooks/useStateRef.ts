import { useRef, useState } from 'react';

export function useStateRef<T>(init: T) {
  const [state, setState] = useState<T>(init);
  const stateRef = useRef(init);

  function setStateWrapper(fn: (v: T) => T) {
    function wrap(existing: T) {
      stateRef.current = fn(existing);
      return stateRef.current;
    }
    setState(wrap);
  }

  const ret: [T, typeof setStateWrapper, typeof stateRef] = [state, setStateWrapper, stateRef];
  return ret;
}

import { useState, useEffect, useRef } from "react";

const KEYBOARD_THRESHOLD_PX = 150;

export interface KeyboardState {
  isKeyboardVisible: boolean;
  keyboardHeight: number;
}

export function useKeyboardVisible(): KeyboardState {
  const [state, setState] = useState<KeyboardState>({
    isKeyboardVisible: false,
    keyboardHeight: 0,
  });

  const rafRef = useRef<number | null>(null);
  const baselineHeightRef = useRef<number>(
    typeof window !== "undefined" ? window.innerHeight : 0
  );
  const lastKeyboardVisibleRef = useRef<boolean>(false);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const measure = () => {
      const currentViewportHeight = vv.height;
      const baseline = baselineHeightRef.current;
      const diff = baseline - currentViewportHeight;

      const isKeyboardVisible = diff > KEYBOARD_THRESHOLD_PX;
      const keyboardHeight = isKeyboardVisible ? Math.round(diff) : 0;

      const boolChanged = isKeyboardVisible !== lastKeyboardVisibleRef.current;

      if (boolChanged) {
        lastKeyboardVisibleRef.current = isKeyboardVisible;
        setState({ isKeyboardVisible, keyboardHeight });
      } else if (isKeyboardVisible) {
        setState((prev) => {
          if (prev.keyboardHeight !== keyboardHeight) {
            return { isKeyboardVisible, keyboardHeight };
          }
          return prev;
        });
      }
    };

    const onResize = () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(measure);
    };

    const onOrientationChange = () => {
      setTimeout(() => {
        baselineHeightRef.current = vv.height;
        lastKeyboardVisibleRef.current = false;
        setState({ isKeyboardVisible: false, keyboardHeight: 0 });
      }, 300);
    };

    vv.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onOrientationChange);

    return () => {
      vv.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onOrientationChange);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return state;
}

// Minimal canvas stub so texture generators run headless in node (pixels are discarded).
const ctx: any = new Proxy(
  {},
  {
    get(t: any, k) {
      if (k in t) return t[k];
      if (k === 'getImageData' || k === 'createImageData')
        return (a: any, b: any, w?: number, h?: number) => {
          const W = w ?? (typeof a === 'number' ? a : a.width);
          const H = h ?? (typeof b === 'number' ? b : a.height);
          return { data: new Uint8ClampedArray(W * H * 4), width: W, height: H };
        };
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => ({ addColorStop() {} });
      if (k === 'measureText') return () => ({ width: 10 });
      return () => {};
    },
    set(t: any, k, v) {
      t[k] = v;
      return true;
    },
  },
);
(globalThis as any).Path2D = class { constructor(_s?: string) {} };
(globalThis as any).document = { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => ctx }) };
export {};

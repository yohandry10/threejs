import { h, type ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { App } from '../app/app';
import { heraldrySVG } from '../data/heraldry';
import { factionDef } from '../data/factions';
import { portraitSVG } from './portrait';
import type { Character } from '../sim/types';

export function useApp(app: App) {
  const [, set] = useState(0);
  useEffect(() => app.subscribe(() => set((v) => v + 1)), [app]);
  return app;
}

// ------------------------------------------------------------------ tooltip
type TipContent = ComponentChildren | (() => ComponentChildren);
let tipSetter: ((t: { content: TipContent; x: number; y: number } | null) => void) | null = null;

export function TooltipHost() {
  const [t, setT] = useState<{ content: TipContent; x: number; y: number } | null>(null);
  useEffect(() => {
    tipSetter = setT;
    return () => {
      tipSetter = null;
    };
  }, []);
  if (!t) return null;
  const content = typeof t.content === 'function' ? (t.content as () => ComponentChildren)() : t.content;
  const left = Math.min(t.x + 16, window.innerWidth - 350);
  const top = Math.min(t.y + 18, window.innerHeight - 160);
  return (
    <div class="tooltip" style={{ left: `${left}px`, top: `${top}px` }}>
      {content}
    </div>
  );
}

export function Tip(props: { tip: TipContent; children: ComponentChildren; class?: string; style?: Record<string, string> }) {
  return (
    <span
      class={props.class}
      style={props.style}
      onMouseEnter={(e) => tipSetter?.({ content: props.tip, x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY })}
      onMouseMove={(e) => tipSetter?.({ content: props.tip, x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY })}
      onMouseLeave={() => tipSetter?.(null)}
    >
      {props.children}
    </span>
  );
}
export const hideTip = () => tipSetter?.(null);

export function TipRows(props: { title?: string; rows: [string, string | number, string?][]; foot?: ComponentChildren }) {
  return (
    <div>
      {props.title && <div class="tt-title">{props.title}</div>}
      {props.rows.map(([k, v, cls]) => (
        <div class="tt-row">
          <span class="muted">{k}</span>
          <span class={cls}>{typeof v === 'number' ? fmtSigned(v) : v}</span>
        </div>
      ))}
      {props.foot && <div class="small muted" style={{ marginTop: '6px' }}>{props.foot}</div>}
    </div>
  );
}

export const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
export const fmtSigned = (n: number) => (n > 0 ? '+' : '') + Math.round(n).toLocaleString('en-US');

// ------------------------------------------------------------------ heraldry & portraits
export function Shield(props: { faction: string; size?: number }) {
  const html = heraldrySVG(factionDef(props.faction).heraldry, props.size ?? 28, props.faction);
  return <span style={{ display: 'inline-flex', lineHeight: 0 }} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Portrait(props: { c: Character; age: number; w?: number; h?: number; onClick?: () => void }) {
  const w = props.w ?? 64;
  const hh = props.h ?? Math.round(w * 1.2);
  return <div class="portrait" style={{ width: `${w}px`, height: `${hh}px`, cursor: props.onClick ? 'pointer' : 'default' }} onClick={props.onClick} dangerouslySetInnerHTML={{ __html: portraitSVG(props.c, props.age, w, hh) }} />;
}

// ------------------------------------------------------------------ icons
const I = (d: string, fill = 'currentColor', vb = '0 0 24 24') => (props: { size?: number; color?: string }) => (
  <svg viewBox={vb} width={props.size ?? 16} height={props.size ?? 16} style={{ flexShrink: 0 }}>
    <path d={d} fill={props.color ?? fill} fill-rule="evenodd" />
  </svg>
);
export const Icons = {
  gold: I('M12 3a9 9 0 1 1 0 18a9 9 0 0 1 0-18Zm0 2.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 0 0 0-13Zm-1 2.5h2v1.2c1.3.3 2.2 1.1 2.4 2.3h-2c-.2-.5-.7-.8-1.4-.8-.8 0-1.3.3-1.3.8 0 .6.6.8 1.8 1.1 1.8.4 3 1.1 3 2.7 0 1.3-1 2.2-2.5 2.5V17h-2v-1.2c-1.5-.3-2.5-1.2-2.6-2.5h2c.1.6.7 1 1.6 1 .9 0 1.4-.3 1.4-.8 0-.6-.6-.8-1.9-1.1-1.7-.4-2.9-1-2.9-2.6 0-1.2.9-2.1 2.4-2.4V8Z', '#e0b34a'),
  food: I('M12 2c.6 2.4 2.6 3.1 2.6 5.3 0 1.5-1.1 2.5-2.6 2.5s-2.6-1-2.6-2.5C9.4 5.1 11.4 4.4 12 2Zm-5 7c2.2.3 3.6 1.7 3.9 4-2.2-.2-3.6-1.7-3.9-4Zm10 0c-.3 2.3-1.7 3.8-3.9 4 .3-2.3 1.7-3.7 3.9-4Zm-10 5c2.2.3 3.6 1.7 3.9 4-2.2-.2-3.6-1.7-3.9-4Zm10 0c-.3 2.3-1.7 3.8-3.9 4 .3-2.3 1.7-3.7 3.9-4ZM11 11h2v11h-2V11Z', '#d7b35a'),
  timber: I('M3 8h14a3 3 0 1 1 0 6H3V8Zm14 1.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 0 0 0-3ZM3 15h14a3 3 0 1 1 0 6H3v-6Zm14 1.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 0 0 0-3Z', '#a77a4c'),
  stone: I('M4 13l3-6h10l3 6-3 6H7l-3-6Zm4.2-4L6.2 13l2 4h7.6l2-4-2-4H8.2Z', '#b8b3a8'),
  iron: I('M3 16l3-7h12l3 7H3Zm4.3-5.5L5.4 14.5h13.2l-1.9-4H7.3Z', '#9fa6ad'),
  prestige: I('M3 18L2 7l5 4 5-7 5 7 5-4-1 11H3Zm0 2h18v2H3v-2Z', '#e6c67e'),
  legitimacy: I('M11 2h2v3h6l-3 6a3 3 0 0 1-6 0L7 5h4V2ZM7.8 7l2 4a1 1 0 0 0 1.9 0l.3-.6L10 7H7.8Zm8.4 0H14l-1.2 2.4 1.1 1.7L16.2 7ZM5 20h14v2H5v-2Zm6-8h2v8h-2v-8Z', '#c9a45c'),
  faction: I('M4 3h16v8c0 5.5-3.5 9-8 11-4.5-2-8-5.5-8-11V3Zm2 2v6c0 4.3 2.6 7.2 6 8.9 3.4-1.7 6-4.6 6-8.9V5H6Z'),
  diplomacy: I('M2 12l4-4 3 2 3-3 3 3 3-2 4 4-4 5-2-1-3 3-2-1-2 1-3-3-2 1-4-5Zm4.3-1.3L4.7 12.3l2.4 3 1.6-.8L6.3 10.7Zm11.4 0l-2.4 3.8 1.6.8 2.4-3-1.6-1.6Z'),
  dynasty: I('M11 2h2v4h4v2h-4v3h5v2h-3v3h3v2h-3v4h-2v-4H9v4H7v-4H4v-2h3v-3H4v-2h5V8H7V6h4V2Zm-2 11v3h4v-3H9Z'),
  council: I('M12 4c5 0 9 3.6 10 8-1 4.4-5 8-10 8S3 16.4 2 12c1-4.4 5-8 10-8Zm0 2a6 6 0 1 0 0 12a6 6 0 0 0 0-12Zm0 3a3 3 0 1 1 0 6a3 3 0 0 1 0-6Z'),
  objectives: I('M5 2h2v20H5V2Zm3 1h11l-2 4 2 4H8V3Z'),
  chronicle: I('M5 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a3 3 0 0 1-3-3V5a2 2 0 0 1 1-2Zm1 2v13a1 1 0 0 0 1 1h10V5H6Zm2 3h7v2H8V8Zm0 4h7v2H8v-2Z'),
  menu: I('M3 5h18v2H3V5Zm0 6h18v2H3v-2Zm0 6h18v2H3v-2Z'),
  help: I('M12 2a10 10 0 1 1 0 20a10 10 0 0 1 0-20Zm0 2a8 8 0 1 0 0 16a8 8 0 0 0 0-16Zm-1 12h2v2h-2v-2Zm1-10c2.2 0 4 1.5 4 3.5 0 1.7-1 2.5-2 3.1-.6.4-1 .8-1 1.4v.5h-2v-.6c0-1.4.8-2.1 1.7-2.7.8-.5 1.3-.9 1.3-1.7 0-.9-.9-1.5-2-1.5s-2 .7-2 1.7H8C8 7.6 9.8 6 12 6Z'),
  sword: I('M19 2l3 3-11 11 1.5 1.5-1.5 1.5-2-2-3 3-2-2 3-3-2-2 1.5-1.5L8 13 19 2Z'),
  spear: I('M20 2l2 2-3 1-13 13 1 1-2 2-3-3 2-2 1 1L18 4l2-2Z'),
  bow: I('M4 3c7 1 13 7 14 14l2 2-1 1-2-2C10 17 5 12 4 5L3 4l1-1Zm1.8 2.5c.9 5.2 5.4 9.8 10.7 10.8L5.8 5.5Z'),
  crossbow: I('M3 11h18v2h-8v7h-2v-7H3v-2Zm9-8l1 6h-2l1-6Z'),
  horse: I('M8 3l2 2c3-1 7 0 9 4l2 6-2 1-2-4v9h-2v-6h-4v6H9v-7l-3 1-2-3 4-4-1-3 1-2Z'),
  siege: I('M3 18h18v2H3v-2Zm2-2l5-12 2 1-3 7 8-2 1 2-10 3-3 1Z'),
  ship: I('M11 2h2v9h7l-3 5H7l-3-5h7V2Zm-8 16h18c-1 2.5-4 4-9 4s-8-1.5-9-4Z'),
  crown: I('M3 18L2 7l5 4 5-7 5 7 5-4-1 11H3Z', '#e6c67e'),
  endTurn: I('M6 4l12 8-12 8V4Z'),
  save: I('M5 3h11l3 3v15H5V3Zm2 2v5h8V5H7Zm2 9a3 3 0 1 0 6 0a3 3 0 0 0-6 0Z'),
  swords: I('M4 2l7 7-2 2-7-7V2h2Zm16 0h2v2l-9 9 2 2-2 2-2-2-3 3 1 2-2 2-3-3-3-3 2-2 2 1 3-3-2-2 2-2 2 2 9-9Z'),
};

export function UnitIcon(props: { cat: string; size?: number }) {
  const s = props.size ?? 26;
  const map: Record<string, (p: { size?: number }) => h.JSX.Element> = {
    militia: Icons.spear,
    infantry: Icons.sword,
    spear: Icons.spear,
    heavy: Icons.swords,
    archer: Icons.bow,
    crossbow: Icons.crossbow,
    lightcav: Icons.horse,
    heavycav: Icons.horse,
    knight: Icons.horse,
    general: Icons.crown,
    siege: Icons.siege,
  };
  const C = map[props.cat] ?? Icons.sword;
  return <C size={s} />;
}

export function Meter(props: { v: number; max?: number; color?: string }) {
  const pct = Math.max(0, Math.min(1, props.v / (props.max ?? 100))) * 100;
  return (
    <div class="meter">
      <div style={{ width: `${pct}%`, background: props.color ?? 'var(--gold)' }} />
    </div>
  );
}

export function Modal(props: { title: ComponentChildren; onClose?: () => void; children: ComponentChildren; foot?: ComponentChildren; wide?: boolean }) {
  return (
    <div class="modal-back" onMouseDown={(e) => e.stopPropagation()}>
      <div class={`panel modal ${props.wide ? 'wide' : ''}`}>
        <div class="panel-head">
          <h2>{props.title}</h2>
          {props.onClose && (
            <button class="close-x" onClick={props.onClose}>
              ×
            </button>
          )}
        </div>
        <div class="panel-body scroll">{props.children}</div>
        {props.foot && <div class="foot">{props.foot}</div>}
      </div>
    </div>
  );
}

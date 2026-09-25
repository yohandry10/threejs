import { h } from 'preact';
import * as THREE from 'three';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { App } from '../app/app';
import type { CampaignScene } from '../scenes/campaignScene';
import { factionDef } from '../data/factions';
import { Icons, Shield, Tip, TipRows, fmt, fmtSigned } from './common';
import { SEASON_NAMES, seasonOf, yearOf } from '../sim/types';
import { factionEconomy, TAX_NAMES } from '../sim/economy';
import { MAP_MODES } from '../render/campaign/mapModes';
import { WEATHER_LABEL } from '../sim/weather';
import { fullName } from '../sim/characters';
import { heightAt, Biome } from '../sim/world/geo';
import { exploredBits, visibleBits } from '../sim/fog';
import { atWar, isAllied } from '../sim/diplomacy';
import { troopCount } from '../sim/military';
import { isVisible } from '../sim/fog';

export function TopBar(props: { app: App; cs: CampaignScene }) {
  const { app, cs } = props;
  const sim = cs.sim;
  const f = sim.fac(sim.s.player);
  const eco = factionEconomy(sim, f.id);
  const ruler = sim.char(f.ruler);
  const s = sim.s;
  const region = sim.geo.provinces[f.capital]?.region;
  const weather = s.weather.regions[region ?? 'west'] ?? 'clear';
  return (
    <div class="topbar">
      <div class="house" onClick={() => app.ui.openPanel('faction')}>
        <Shield faction={f.id} size={26} />
        <div>
          <div class="name">{sim.houseName(f.id)}</div>
          <div class="tiny muted">{ruler ? `${ruler.name}, ${ruler.gender === 'm' ? 'King' : 'Queen'}` : ''}</div>
        </div>
      </div>
      <Tip
        class="res"
        tip={() => (
          <TipRows
            title="Treasury"
            rows={[
              ['Taxes', eco.tax, 'good'],
              ['Trade', eco.trade, 'good'],
              ['Towns & buildings', eco.buildings, 'good'],
              ['Tribute', eco.tribute],
              ['Army upkeep', -eco.armyUpkeep, 'bad'],
              ['Fleet upkeep', -eco.fleetUpkeep, 'bad'],
              ['Court', -eco.courtUpkeep, 'bad'],
              ...(eco.grainImports ? [['Grain imports', -eco.grainImports, 'bad'] as [string, number, string]] : []),
              ['Net per season', eco.net, eco.net >= 0 ? 'good' : 'bad'],
            ]}
            foot={`Tax level: ${TAX_NAMES[f.taxLevel]}. An empty treasury causes desertion and unrest.`}
          />
        )}
      >
        <Icons.gold />
        <span class="v">{fmt(f.treasury)}</span>
        <span class={`d ${eco.net >= 0 ? 'good' : 'bad'}`}>{fmtSigned(eco.net)}</span>
      </Tip>
      <Tip
        class="res"
        tip={() => (
          <TipRows
            title="Food"
            rows={[
              ['Produced', eco.foodProduced, 'good'],
              ['Eaten by people & armies', -eco.foodConsumed, 'bad'],
              ['Net', eco.food, eco.food >= 0 ? 'good' : 'bad'],
              ['Stored', fmt(f.food)],
            ]}
            foot="Harvests peak in autumn and fail in winter. Famine kills people and shrinks armies."
          />
        )}
      >
        <Icons.food />
        <span class="v">{fmt(f.food)}</span>
        <span class={`d ${eco.food >= 0 ? 'good' : 'bad'}`}>{fmtSigned(eco.food)}</span>
      </Tip>
      <Tip class="res" tip={<TipRows title="Timber" rows={[['Per season', eco.timber, 'good']]} foot="Needed for buildings and ships. Lumber yards increase output." />}>
        <Icons.timber />
        <span class="v">{fmt(f.timber)}</span>
      </Tip>
      <Tip class="res" tip={<TipRows title="Stone" rows={[['Per season', eco.stone, 'good']]} foot="Needed for walls, towers and great buildings. Quarries and mines increase output." />}>
        <Icons.stone />
        <span class="v">{fmt(f.stone)}</span>
      </Tip>
      <Tip class="res" tip={<TipRows title="Iron" rows={[['Per season', eco.iron, 'good']]} foot="Needed to equip soldiers, especially armoured troops." />}>
        <Icons.iron />
        <span class="v">{fmt(f.iron)}</span>
      </Tip>
      <Tip class="res" tip={<TipRows title="Prestige" rows={[['House prestige', fmt(f.prestige)]]} foot="Won through victories, marriages, great buildings and long reigns. Improves diplomacy; drives dynastic victory." />}>
        <Icons.prestige />
        <span class="v">{fmt(f.prestige)}</span>
      </Tip>
      <Tip class="res" tip={<TipRows title="Legitimacy" rows={[['Ruler legitimacy', `${Math.round(f.legitimacy)} / 100`]]} foot="Low legitimacy weakens public order, invites pretenders and harms diplomacy. Grows with a long, just reign." />}>
        <Icons.legitimacy />
        <span class={`v ${f.legitimacy < 35 ? 'bad' : ''}`}>{Math.round(f.legitimacy)}</span>
      </Tip>
      <div class="date">
        <Tip tip={<TipRows title={WEATHER_LABEL[weather]} rows={[]} foot="Weather in your home region this season. Storms slow fleets; snow slows armies; rain weakens archers." />}>
          <span class="small muted">{WEATHER_LABEL[weather]}</span>
        </Tip>
        <span class="season">{SEASON_NAMES[seasonOf(s.turn)]}</span>
        <span>{yearOf(s)}</span>
        <button class="btn small icon" onClick={() => app.ui.toggleMenu()} title="Menu">
          <Icons.menu />
        </button>
      </div>
    </div>
  );
}

export function Rail(props: { app: App; cs: CampaignScene }) {
  const { app, cs } = props;
  const items: [string, keyof typeof Icons, string, number?][] = [
    ['faction', 'faction', 'Realm overview'],
    ['diplomacy', 'diplomacy', 'Diplomacy (P)', cs.sim.s.decisions.filter((d) => d.kind === 'proposal').length],
    ['dynasty', 'dynasty', 'Dynasty & family tree (F)'],
    ['council', 'council', 'Council & intrigue'],
    ['objectives', 'objectives', 'Objectives & victory'],
    ['chronicle', 'chronicle', 'Chronicle of the realm'],
    ['help', 'help', 'How to play'],
  ];
  return (
    <div class="rail">
      {items.map(([p, icon, title, badge]) => {
        const C = Icons[icon];
        return (
          <Tip tip={<div class="serif">{title}</div>}>
            <button class={`btn ${app.ui.panel === p ? 'active' : ''}`} style={{ position: 'relative' }} onClick={() => app.ui.openPanel(p as never)}>
              <C size={22} />
              {badge ? <span class="badge">{badge}</span> : null}
            </button>
          </Tip>
        );
      })}
    </div>
  );
}

export function MapModeBar(props: { cs: CampaignScene }) {
  const cs = props.cs;
  return (
    <div class="mapmodes pe">
      {MAP_MODES.map((m) => (
        <Tip tip={<div>{m.label} map mode <span class="kbd">{m.key}</span></div>}>
          <button class={`btn ${cs.mapMode === m.id ? 'active' : ''}`} onClick={() => cs.setMapMode(m.id)}>
            {m.label}
          </button>
        </Tip>
      ))}
    </div>
  );
}

export function EndTurn(props: { app: App; cs: CampaignScene }) {
  const { cs } = props;
  const pending = cs.sim.s.decisions.length;
  const idle = cs.sim.armiesOf(cs.sim.s.player).filter((a) => a.movePoints >= a.maxMovePoints * 0.99 && !a.path.length && a.siegeOf === undefined && a.embarked === undefined).length;
  return (
    <div class="endturn pe">
      {pending > 0 && <div class="small warnc serif">{pending} matter{pending > 1 ? 's' : ''} await your judgement</div>}
      <Tip tip={<div>End the season and let the other houses act. <span class="kbd">Enter</span>{idle ? <div class="muted small">{idle} of your armies have not moved.</div> : null}</div>}>
        <button class="btn primary" disabled={cs.busy || !!cs.sim.s.victory} onClick={() => cs.endTurn()}>
          {cs.busy ? 'The realm stirs…' : 'End Season'}
        </button>
      </Tip>
    </div>
  );
}

export function Notifications(props: { app: App; cs: CampaignScene }) {
  const { app, cs } = props;
  const s = cs.sim.s;
  const recent = s.notifications.filter((n) => !n.read && n.turn >= s.turn - 1).slice(-6).reverse();
  return (
    <div class="notifs pe">
      {recent.map((n) => (
        <div
          class={`notif ${n.kind}`}
          onClick={() => {
            n.read = true;
            if (n.focus) cs.view.cam.focus(n.focus.x, n.focus.z, 600);
            app.notify();
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            n.read = true;
            app.notify();
          }}
        >
          <div class="nt">{n.title}</div>
          <div class="nx">{n.text}</div>
        </div>
      ))}
      {recent.length > 0 && (
        <div
          class="tiny faint"
          style={{ cursor: 'pointer', textAlign: 'right' }}
          onClick={() => {
            for (const n of s.notifications) n.read = true;
            app.notify();
          }}
        >
          dismiss all
        </div>
      )}
    </div>
  );
}

export function Toast(props: { cs: CampaignScene }) {
  const t = props.cs.toast;
  if (!t) return null;
  return <div class={`toast ${t.kind === 'warn' ? 'warn' : ''}`}>{t.text}</div>;
}

export function BusyOverlay(props: { cs: CampaignScene }) {
  const cs = props.cs;
  if (!cs.busy || cs.pendingBattle) return null;
  return (
    <div class="panel busy">
      <div class="spinner" />
      <span>{cs.turnLabel}</span>
    </div>
  );
}

/** Settlement names and army banners that follow the 3D view (updated imperatively every frame). */
export function Markers(props: { cs: CampaignScene }) {
  const cs = props.cs;
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const els = new Map<string, HTMLDivElement>();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const r = root.current;
      if (!r) return;
      const sim = cs.sim;
      const dist = cs.view.cam.distance;
      const seen = new Set<string>();
      const place = (key: string, html: () => string, x: number, y: number, z: number, cls: string, show: boolean) => {
        let el = els.get(key);
        if (!show) {
          if (el) el.style.display = 'none';
          return;
        }
        const p = cs.project(x, y, z);
        if (!p.visible || p.x < -100 || p.y < -50 || p.x > window.innerWidth + 100 || p.y > window.innerHeight + 50) {
          if (el) el.style.display = 'none';
          return;
        }
        if (!el) {
          el = document.createElement('div');
          el.className = cls;
          r.appendChild(el);
          els.set(key, el);
        }
        const content = html();
        if (el.dataset.c !== content) {
          el.innerHTML = content;
          el.dataset.c = content;
        }
        el.style.display = '';
        el.style.left = `${p.x}px`;
        el.style.top = `${p.y}px`;
        seen.add(key);
      };
      const exp = exploredBits(sim);
      for (const pg of sim.geo.provinces) {
        const p = sim.s.provinces[pg.id];
        const explored = exp[pg.cell] === 1;
        const cap = sim.fac(p.owner)?.capital === pg.id;
        const show = explored && (dist < 2600 || cap || p.settlement.tier >= 2);
        const siege = p.siege ? ' · <span style="color:#e7998f">besieged</span>' : '';
        place(`s${pg.id}`, () => `<div class="mname ${cap ? 'cap' : ''}">${p.settlement.name}</div><div class="msub">${factionDef(p.owner).short}${siege}</div>`, pg.x, pg.elevation + 40 + Math.min(80, dist * 0.02), pg.z, 'marker', show);
      }
      if (dist > 500) {
        for (const a of Object.values(sim.s.armies)) {
          if (a.embarked !== undefined) continue;
          const own = a.faction === sim.s.player;
          if (!own && !isVisible(sim, a.x, a.z)) continue;
          const v = cs.view.forces.armies.get(a.id);
          if (!v) continue;
          const rel = own ? '' : atWar(sim, a.faction, sim.s.player) ? 'enemy' : isAllied(sim, a.faction, sim.s.player) ? 'ally' : '';
          const known = own || isAllied(sim, a.faction, sim.s.player) || (sim.fac(sim.s.player).intelOn[a.faction] ?? -1) > sim.s.turn || Math.hypot(a.x - (cs.selectedArmy?.x ?? 1e9), a.z - (cs.selectedArmy?.z ?? 1e9)) < 400;
          const tc = troopCount(a.units);
          const count = known ? fmt(tc) : `~${Math.round(tc / 500) * 500 || 'few'}`;
          place(`a${a.id}`, () => `<span style="display:inline-flex">${shieldMini(a.faction)}</span><span>${count}</span>`, v.x, heightAt(sim.geo, v.x, v.z) + 14 + dist * 0.012, v.z, `amark ${rel}`, true);
        }
      }
      for (const [k, el] of els) if (!seen.has(k)) el.style.display = 'none';
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cs]);
  return <div ref={root} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }} />;
}

const miniCache = new Map<string, string>();
function shieldMini(f: string) {
  let s = miniCache.get(f);
  if (!s) {
    const d = factionDef(f);
    s = `<svg viewBox="0 0 10 12" width="12" height="14"><path d="M0 0H10V5Q10 10 5 12Q0 10 0 5Z" fill="${d.color}" stroke="${d.color2}" stroke-width="1"/></svg>`;
    miniCache.set(f, s);
  }
  return s;
}

export function Minimap(props: { app: App; cs: CampaignScene }) {
  const cs = props.cs;
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const g = cs.sim.geo;
    const W = g.navW;
    const H = g.navH;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    // base terrain image
    const base = ctx.createImageData(W, H);
    const col: Record<number, number[]> = { 0: [22, 38, 58], 1: [34, 62, 88], 2: [196, 180, 140], 3: [96, 122, 64], 4: [150, 140, 76], 5: [44, 80, 44], 6: [40, 66, 50], 7: [120, 116, 80], 8: [118, 110, 100], 9: [230, 232, 236], 10: [168, 150, 92], 11: [128, 128, 104], 12: [66, 58, 54], 13: [70, 90, 70] };
    for (let c = 0; c < W * H; c++) {
      const x = c % W;
      const z = Math.floor(c / W);
      const b = g.biome[(z * 2) * g.hmW + x * 2];
      const h = g.height[(z * 2) * g.hmW + x * 2];
      const cc = col[b] ?? [255, 0, 255];
      const shade = b <= Biome.Sea ? 1 : 0.85 + Math.min(0.3, h / 900);
      base.data[c * 4] = cc[0] * shade;
      base.data[c * 4 + 1] = cc[1] * shade;
      base.data[c * 4 + 2] = cc[2] * shade;
      base.data[c * 4 + 3] = 255;
      if (g.river[c]) base.data.set([60, 100, 150, 255], c * 4);
    }
    const img = ctx.createImageData(W, H);
    let raf = 0;
    let last = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - last < 200) return;
      last = t;
      const sim = cs.sim;
      const exp = exploredBits(sim);
      const vis = visibleBits(sim);
      const ownerCol = new Map<number, number[]>();
      for (const p of sim.s.provinces) {
        const hex = parseInt(factionDef(p.owner).color.slice(1), 16);
        ownerCol.set(p.id, [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]);
      }
      const d = img.data;
      const bd = base.data;
      const political = cs.mapMode !== 'terrain';
      for (let c = 0; c < W * H; c++) {
        let r = bd[c * 4];
        let gg = bd[c * 4 + 1];
        let b = bd[c * 4 + 2];
        const pid = g.province[c];
        if (political && pid >= 0) {
          const oc = ownerCol.get(pid)!;
          r = r * 0.5 + oc[0] * 0.5;
          gg = gg * 0.5 + oc[1] * 0.5;
          b = b * 0.5 + oc[2] * 0.5;
          const x = c % W;
          if ((x + 1 < W && g.province[c + 1] !== pid && g.province[c + 1] >= 0) || (c + W < W * H && g.province[c + W] !== pid && g.province[c + W] >= 0)) {
            r *= 0.55;
            gg *= 0.55;
            b *= 0.55;
          }
        }
        if (!exp[c]) {
          r = 26;
          gg = 24;
          b = 22;
        } else if (!vis[c]) {
          r *= 0.72;
          gg *= 0.72;
          b *= 0.72;
        }
        d[c * 4] = r;
        d[c * 4 + 1] = gg;
        d[c * 4 + 2] = b;
        d[c * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      const sx = 1 / g.navStep;
      // settlements
      for (const pg of g.provinces) {
        if (!exp[pg.cell]) continue;
        const p = sim.s.provinces[pg.id];
        const cap = sim.fac(p.owner)?.capital === pg.id;
        ctx.fillStyle = cap ? '#ffe39a' : '#f0e8d6';
        ctx.strokeStyle = '#000';
        const r = cap ? 3.2 : 2.2;
        ctx.fillRect(pg.x * sx - r, pg.z * sx - r, r * 2, r * 2);
        ctx.strokeRect(pg.x * sx - r, pg.z * sx - r, r * 2, r * 2);
      }
      // armies & fleets
      const player = sim.s.player;
      for (const a of Object.values(sim.s.armies)) {
        if (a.embarked !== undefined) continue;
        const own = a.faction === player;
        if (!own && !vis[a.cell]) continue;
        ctx.fillStyle = own ? '#ffd24a' : isAllied(sim, a.faction, player) ? '#7fdc6a' : atWar(sim, a.faction, player) ? '#ff4a3a' : '#c8c8c8';
        ctx.beginPath();
        ctx.arc(a.x * sx, a.z * sx, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      for (const f of Object.values(sim.s.fleets)) {
        const own = f.faction === player;
        if (!own && !vis[f.cell]) continue;
        ctx.fillStyle = own ? '#ffd24a' : isAllied(sim, f.faction, player) ? '#7fdc6a' : atWar(sim, f.faction, player) ? '#ff4a3a' : '#c8c8c8';
        ctx.beginPath();
        ctx.moveTo(f.x * sx, f.z * sx - 4);
        ctx.lineTo(f.x * sx + 3.5, f.z * sx + 3);
        ctx.lineTo(f.x * sx - 3.5, f.z * sx + 3);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      // camera footprint
      const corners = [
        [-1, 1],
        [1, 1],
        [1, -1],
        [-1, -1],
      ].map(([x, y]) => groundPlane(cs, x, y));
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      corners.forEach((p, i) => (i ? ctx.lineTo(p.x * sx, p.z * sx) : ctx.moveTo(p.x * sx, p.z * sx)));
      ctx.closePath();
      ctx.stroke();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [cs]);
  const onClick = (e: MouseEvent) => {
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const g = cs.sim.geo;
    const x = ((e.clientX - rect.left) / rect.width) * g.W;
    const z = ((e.clientY - rect.top) / rect.height) * g.H;
    cs.view.cam.focus(x, z);
  };
  return (
    <div class="panel minimap pe">
      <canvas ref={ref} onMouseDown={(e) => onClick(e as MouseEvent)} />
    </div>
  );
}

function groundPlane(cs: CampaignScene, nx: number, ny: number) {
  const cam = cs.view.cam.camera;
  const v = new THREE.Vector3(nx, ny, 0.5).unproject(cam);
  const dir = v.sub(cam.position).normalize();
  let t = dir.y < -0.01 ? -cam.position.y / dir.y : 20000;
  t = Math.min(t, 20000);
  return { x: cam.position.x + dir.x * t, z: cam.position.z + dir.z * t };
}

export function Tutorial(props: { app: App; cs: CampaignScene }) {
  const { app, cs } = props;
  const tut = cs.sim.s.tutorial;
  if (!tut.enabled || tut.done || cs.introT >= 0) return null;
  const steps: [string, string][] = [
    ['Welcome, my liege', 'Move the camera with W A S D or by dragging with the left mouse button. Scroll to zoom — from the whole realm down to the streets of your capital. Hold the middle mouse button (or Shift + drag) to rotate. Press H to return home.'],
    ['Your settlements', 'Left-click your capital to inspect it. In the settlement panel you can construct buildings (farms, markets, walls, harbours) and recruit soldiers and ships. Everything costs gold, materials and time.'],
    ['Armies', 'Left-click an army (its banner) to select it. The golden area shows how far it can march this season. Right-click the ground to move, right-click an enemy army or settlement to attack. Armies must board ships to cross the sea.'],
    ['Diplomacy & dynasty', 'Open Diplomacy (P) to propose alliances, trade, marriages, or declare war. The Dynasty screen (F) shows your family tree and line of succession. Marriages can win you claims — or whole kingdoms.'],
    ['Battles', 'When armies meet, you may fight the battle yourself or let it resolve automatically. In battle: left-click or drag to select units, right-click to move or attack, right-drag to set a formation line. Space pauses.'],
    ['The seasons', 'When you are done, press End Season (Enter). Rival houses will act, crops will grow, and your heirs will age. Good fortune, my liege.'],
  ];
  const [title, text] = steps[Math.min(tut.step, steps.length - 1)];
  return (
    <div class="panel help pe">
      <div class="panel-head">
        <h3>{title}</h3>
        <span class="tiny muted" style={{ marginLeft: 'auto' }}>
          {tut.step + 1}/{steps.length}
        </span>
      </div>
      <div class="panel-body small" style={{ lineHeight: 1.5 }}>
        {text}
      </div>
      <div class="foot" style={{ display: 'flex', gap: '6px', padding: '0 14px 10px', justifyContent: 'flex-end' }}>
        <button class="btn small" onClick={() => ((tut.done = true), app.notify())}>
          Dismiss
        </button>
        <button
          class="btn small primary"
          onClick={() => {
            tut.step++;
            if (tut.step >= steps.length) tut.done = true;
            app.notify();
          }}
        >
          {tut.step + 1 >= steps.length ? 'Done' : 'Next'}
        </button>
      </div>
    </div>
  );
}

export { fullName };

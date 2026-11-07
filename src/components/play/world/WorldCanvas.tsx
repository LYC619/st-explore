import { useEffect, useRef, useState } from 'react';
import { LocateFixed, Minus, Plus } from 'lucide-react';
import { EDGES, isRaining } from '@/play/world/simulation';
import type { Actor, WorldState } from '@/play/world/schema';

function actorPosition(state: WorldState, actor: Actor): [number, number] {
  const origin = state.regions[actor.region], destination = actor.job?.type === 'move' ? state.regions[actor.job.to!] : null;
  const fraction = destination ? 1 - actor.job!.remaining / actor.job!.duration : 0;
  const occupants = state.actors.filter(a => a.region === actor.region), index = occupants.findIndex(a => a.id === actor.id);
  const columns = Math.min(4, occupants.length), rows = Math.ceil(occupants.length / columns);
  return [origin.x + ((destination?.x ?? origin.x) - origin.x) * fraction + (index % columns - (columns - 1) / 2) * 54,
    origin.y + ((destination?.y ?? origin.y) - origin.y) * fraction + (Math.floor(index / columns) - (rows - 1) / 2) * 62 + 24];
}

export function WorldCanvas({ state, selected, focusRegion, onSelect, onRegion }: {
  state: WorldState; selected: string; focusRegion?: string; onSelect: (id: string) => void; onRegion: (id: string) => void;
}) {
  const svg = useRef<SVGSVGElement>(null), drag = useRef<{ x: number; y: number; px: number; py: number }>();
  const [zoom, setZoom] = useState(1), [pan, setPan] = useState({ x: 0, y: 0 }), [scale, setScale] = useState(1);
  const [tracking, setTracking] = useState(true);
  const actor = state.actors.find(a => a.id === selected) ?? state.actors[0];
  const [x, y] = actorPosition(state, actor);
  useEffect(() => {
    const node = svg.current; if (!node) return;
    const observer = new ResizeObserver(() => setScale(Math.max(node.clientWidth / 1040, node.clientHeight / 760)));
    observer.observe(node); return () => observer.disconnect();
  }, []);
  useEffect(() => { setTracking(true); }, [selected, focusRegion]);
  useEffect(() => {
    if (!tracking || !svg.current) return;
    if (svg.current.clientWidth < 760 || focusRegion) {
      const point = focusRegion ? state.regions[focusRegion] : { x, y };
      setPan({ x: (520 - point.x) * zoom, y: (380 - point.y) * zoom });
    }
  }, [x, y, zoom, tracking, focusRegion, state.regions, scale]);
  const hit = Math.max(23, 23 / (scale * zoom));
  return <div className={'world-canvas' + (isRaining(state) ? ' raining' : '')}>
    <svg ref={svg} viewBox="0 0 1040 760" preserveAspectRatio="xMidYMid slice" role="group" aria-label="山海地图，拖动平移，选择人物追踪"
      onPointerDown={event => { if ((event.target as Element).closest('[data-map-target]')) return; setTracking(false); drag.current = { x: event.clientX, y: event.clientY, px: pan.x, py: pan.y }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (!drag.current) return; setPan({ x: Math.max(-700, Math.min(700, drag.current.px + (event.clientX - drag.current.x) / scale)), y: Math.max(-500, Math.min(500, drag.current.py + (event.clientY - drag.current.y) / scale)) }); }}
      onPointerUp={() => { drag.current = undefined; }} onPointerCancel={() => { drag.current = undefined; }}>
      <defs>
        <pattern id="world-grass" width="30" height="28" patternUnits="userSpaceOnUse"><rect width="30" height="28" fill="#719071" /><path d="M4 10l2-4 2 4m13 11l2-4 2 4" fill="none" stroke="#86a17c" strokeWidth="1.5" /></pattern>
        <pattern id="world-woods" width="42" height="38" patternUnits="userSpaceOnUse"><rect width="42" height="38" fill="#44684f" /><path d="M4 23l9-17 9 17zM25 38l8-17 8 17z" fill="#608160" /><path d="M13 23v6m20 9v3" stroke="#9a9d70" strokeWidth="2" /></pattern>
        <pattern id="world-mountains" width="68" height="60" patternUnits="userSpaceOnUse"><rect width="68" height="60" fill="#899b91" /><path d="M3 49L31 5l31 44z" fill="#637b71" /><path d="M31 5l-9 15 11-3 9 4z" fill="#d6ddcb" /><path d="M31 5l31 44H34z" fill="#394f4f" opacity=".45" /></pattern>
        <pattern id="world-sea" width="50" height="35" patternUnits="userSpaceOnUse"><rect width="50" height="35" fill="#3f707b" /><path d="M4 12q10-7 20 0m8 14q8-5 16 0" stroke="#78a0a0" strokeWidth="1.2" fill="none" /></pattern>
        <pattern id="world-farm" width="36" height="30" patternUnits="userSpaceOnUse"><rect width="36" height="30" fill="#afa36e" /><path d="M0 5h36m-36 9h36m-36 9h36" stroke="#c9b886" strokeWidth="2" /></pattern>
        <radialGradient id="world-vignette"><stop offset=".4" stopColor="#182c23" stopOpacity="0" /><stop offset="1" stopColor="#0a2524" stopOpacity=".42" /></radialGradient>
      </defs>
      <g transform={`translate(${pan.x} ${pan.y}) translate(520 380) scale(${zoom}) translate(-520 -380)`}>
        <rect x="-1400" y="-1400" width="4000" height="4000" fill="#577c73" />
        <path d="M0 0H1040V760H0z" fill="url(#world-grass)" />
        <path d="M0 0H1040V170L890 200 820 153 739 205 620 182 530 230 410 189 360 260 230 184 135 210 0 130z" fill="url(#world-mountains)" />
        <path d="M160 220l155 0 100 68-19 126-87 79-140-63-20-91z" fill="url(#world-woods)" />
        <path d="M60 520l170-32 155 51 22 173H75z" fill="url(#world-farm)" />
        <path d="M552 503l170-62 74 81 244 15v223H454l42-161z" fill="url(#world-woods)" />
        <path d="M762 0h278v760H900l32-101-49-52 38-88-44-83 41-91-79-83-16-85-76-52z" fill="url(#world-sea)" />
        <path d="M570 170q-66 87-25 160t-30 153q-57 75-19 145t-43 132" stroke="#b3b897" strokeWidth="43" fill="none" />
        <path d="M570 170q-66 87-25 160t-30 153q-57 75-19 145t-43 132" stroke="#6597a0" strokeWidth="29" fill="none" />
        <path d="M820 460l70 14 28 88-87 28-29-59z" fill="#c0b287" />
        {EDGES.map(edge => {
          const a = state.regions[edge.from], b = state.regions[edge.to], closed = edge.ferry && isRaining(state);
          return <g key={edge.from + edge.to}><path d={`M${a.x} ${a.y}L${b.x} ${b.y}`} stroke={closed ? '#c08d7b' : '#d7c594'} strokeWidth="6" opacity=".7" fill="none" strokeDasharray={edge.ferry ? '6 8' : undefined} />
            <path d={`M${a.x} ${a.y}L${b.x} ${b.y}`} stroke="#6c6747" strokeWidth="1" strokeDasharray="2 8" fill="none" /></g>;
        })}
        {Object.values(state.regions).map(region => <g key={region.id} data-map-target="region" role="button" tabIndex={0} aria-label={`查看地区 ${region.name}`}
          onClick={() => onRegion(region.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRegion(region.id); } }} className="world-region">
          <circle cx={region.x} cy={region.y} r={hit} fill="transparent" />
          <path d={`M${region.x - 10} ${region.y + 8}v-14h20v14zM${region.x - 15} ${region.y - 6}l15-12 15 12z`} fill="#dcd4aa" stroke="#4a5e48" strokeWidth="2" />
          <text x={region.x} y={region.y - 62} textAnchor="middle" className="world-region-name">{region.name}</text>
          {region.id === 'ferry' && isRaining(state) && <text x={region.x} y={region.y - 40} textAnchor="middle" className="world-map-warning">渡口封闭</text>}
        </g>)}
        {actor.job?.type === 'move' && <path d={`M${x} ${y}L${state.regions[actor.job.to!].x} ${state.regions[actor.job.to!].y}`} stroke="#fff0b9" strokeWidth="3" strokeDasharray="4 5" />}
        {state.actors.map(person => {
          const [px, py] = actorPosition(state, person), chosen = person.id === selected;
          return <g key={person.id} data-map-target="actor" data-actor-id={person.id} role="button" tabIndex={0} aria-label={`追踪${person.name}`}
            className={'world-actor' + (chosen ? ' chosen' : '')} style={{ transform: `translate(${px}px, ${py}px)` }}
            onClick={() => onSelect(person.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(person.id); } }}>
            <circle r={hit} fill="transparent" /><circle className="world-actor-halo" r="28" fill="none" stroke="#f4d59a" strokeDasharray="3 5" />
            <circle className="world-actor-rim" r="21" fill="#243e32" stroke="#bbceb1" strokeWidth="1.5" />
            <circle r="16" fill={person.color} /><text y="6" textAnchor="middle" fill="#253e32" fontSize="17" fontWeight="700">{person.name[0]}</text>
            <text y="37" textAnchor="middle" className="world-actor-name">{person.name}</text>
          </g>;
        })}
        <g transform="translate(950 75)" fill="#e4ddbb" opacity=".8"><path d="M0-26L7-3 0 22-7-3z" /><path d="M-21 0H21" stroke="#e4ddbb" /><text y="-35" textAnchor="middle" fontSize="12">北</text></g>
      </g>
      <rect x="0" y="0" width="1040" height="760" fill="url(#world-vignette)" pointerEvents="none" />
    </svg>
    <div className="world-map-title"><span className="world-eyebrow">山海之间 · 原生规则沙盘</span><h2>一念，山海有变。</h2><span className="world-weather">{isRaining(state) ? `雨 · 渡口封闭，剩余 ${state.weather.rainUntil - state.tick + 1} 步` : '晴 · 行路无碍'}</span></div>
    <div className="world-map-tools"><button aria-label="缩小地图" onClick={() => setZoom(v => Math.max(.7, v - .2))}><Minus size={17} /></button><button aria-label="放大地图" onClick={() => setZoom(v => Math.min(2, v + .2))}><Plus size={17} /></button><button aria-label="定位追踪人物" onClick={() => { setZoom(1); setPan({ x: 520 - x, y: 380 - y }); setTracking(true); }}><LocateFixed size={17} /></button></div>
  </div>;
}

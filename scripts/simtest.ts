import { World, TRUCK_MODELS, type Site } from '../src/sim/engine'
import { FL_HL, FL_HW } from '../src/sim/layout'

const HOURS = Number(process.env.SIM_HOURS ?? 6)
const t0 = performance.now()
const w = new World(new Date(process.env.SIM_NOW ?? '2026-10-09T12:05:00+09:00'))
const warmMs = performance.now() - t0
console.log('warmup ms', Math.round(warmMs))
const fmt = (t: number) => {
  const m = Math.floor((((t % 86400) + 86400) % 86400) / 60)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
const report = () =>
  w.sites
    .map((s) => {
      const k = s.kpis(w.time)
      return `${s.cfg.short} 정시${k.onTimePct.toFixed(0)}%(${k.done}) 도크${k.occupied}/${k.opDocks} 대기장${k.yardCount}/${k.yardCap} 대기${k.avgWaitMin.toFixed(0)}m 재고${k.fillPct.toFixed(0)}% 품절${k.out} FL${k.flActive}/${k.flTotal} 인원${k.onFloor}/${k.crew} 휴게${k.onBreak} 게이트${s.stats.gateIn}/${s.stats.gateOut}`
    })
    .join('\n   ')
console.log(fmt(w.time), report())

// ── 겹침 판정 (엔진과 독립: 꼭짓점 4개 + 분리축) ──
type Pt = [number, number]
function corners(x: number, z: number, h: number, back: number, front: number, hw: number): Pt[] {
  const fx = Math.sin(h)
  const fz = Math.cos(h)
  const rx = -fz
  const rz = fx
  return [
    [x + fx * front + rx * hw, z + fz * front + rz * hw],
    [x + fx * front - rx * hw, z + fz * front - rz * hw],
    [x - fx * back - rx * hw, z - fz * back - rz * hw],
    [x - fx * back + rx * hw, z - fz * back + rz * hw],
  ]
}
const EPS = 1e-6
function polyOverlap(a: Pt[], b: Pt[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < 4; i++) {
      const p = poly[i]
      const q = poly[(i + 1) % 4]
      const nx = q[1] - p[1]
      const nz = p[0] - q[0]
      let amin = Infinity
      let amax = -Infinity
      let bmin = Infinity
      let bmax = -Infinity
      for (const c of a) {
        const v = c[0] * nx + c[1] * nz
        amin = Math.min(amin, v)
        amax = Math.max(amax, v)
      }
      for (const c of b) {
        const v = c[0] * nx + c[1] * nz
        bmin = Math.min(bmin, v)
        bmax = Math.max(bmax, v)
      }
      if (amax <= bmin + EPS || bmax <= amin + EPS) return false
    }
  }
  return true
}
// 트럭: 기준점 = 적재함 후면, 전방 len, 폭 2.5 / 지게차: 기준점 = 차체 중심, 1.2 × 3.3
const truckPolys = (s: Site) =>
  [...s.trucks.values()]
    .filter((tr) => tr.phase !== 'enroute' && tr.phase !== 'gone')
    .map((tr) => ({ id: tr.id, poly: corners(tr.mv.pose.x, tr.mv.pose.z, tr.mv.pose.heading, 0, TRUCK_MODELS[tr.model].len, 1.25) }))
const flPolys = (s: Site) => s.forklifts.map((f) => ({ id: f.id, poly: corners(f.mv.pose.x, f.mv.pose.z, f.mv.pose.heading, FL_HL, FL_HL, FL_HW) }))

interface Tally {
  events: number
  steps: number
  active: Set<string>
  samples: string[]
}
const mk = (): Tally => ({ events: 0, steps: 0, active: new Set(), samples: [] })
const tallies = w.sites.map(() => ({ truck: mk(), fl: mk() }))
function countOverlaps(list: { id: string; poly: Pt[] }[], tl: Tally, t: number) {
  const now = new Set<string>()
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      if (!polyOverlap(list[i].poly, list[j].poly)) continue
      const key = `${list[i].id}|${list[j].id}`
      now.add(key)
      tl.steps++
      if (!tl.active.has(key)) {
        tl.events++
        if (tl.samples.length < 6) tl.samples.push(`${fmt(t)} ${key}`)
      }
    }
  tl.active = now
}

// ── 장기 정지 추적 ──
const STUCK_LIMIT = 240
const stuckSince = new Map<string, number>()
const longStops: string[] = []
let maxStop = 0
function trackStuck(s: Site, t: number) {
  const movers = [
    ...[...s.trucks.values()].filter((tr) => tr.phase !== 'enroute' && tr.phase !== 'gone').map((tr) => ({ m: tr.mv, label: `${tr.id}(${tr.phase})` })),
    ...s.forklifts.map((f) => ({ m: f.mv, label: `${f.id}(${f.state})` })),
  ]
  for (const { m, label } of movers) {
    const key = `${s.cfg.id}:${m.id}`
    const wants = m.li < m.legs.length || m.yld != null
    const still = Math.hypot(m.pose.x - m.prev.x, m.pose.z - m.prev.z) < 1e-4 && Math.abs(m.pose.heading - m.prev.heading) < 1e-4
    if (wants && still) {
      const since = stuckSince.get(key) ?? t
      stuckSince.set(key, since)
      const dur = t - since
      maxStop = Math.max(maxStop, dur)
      if (dur === STUCK_LIMIT) {
        const chain: string[] = []
        let cur = m
        for (let k = 0; k < 6 && cur.blockedBy; k++) {
          const nxt = s.truckFleet.get(cur.blockedBy) ?? s.flFleet.get(cur.blockedBy)
          chain.push(cur.blockedBy)
          if (!nxt) break
          cur = nxt
        }
        const leg = m.legs[m.li]
        longStops.push(`${fmt(t)} ${s.cfg.short} ${label} leg=${leg?.kind ?? 'yield'} 막힘: ${chain.join(' → ') || '(없음)'} @(${m.pose.x.toFixed(1)},${m.pose.z.toFixed(1)})`)
      }
    } else stuckSince.delete(key)
  }
}

function invariants(): number {
  let bad = 0
  for (const site of w.sites) {
    for (const b of site.bays) if (b.stock < 0 || b.stock > 8 || b.resIn < 0 || b.resOut < 0) bad++
    for (const sh of site.shipments)
      for (const [li, l] of sh.lines.entries()) {
        if (l.flight < 0 || l.done > l.qty) bad++
        if (site.forklifts.filter((f) => f.task?.shipId === sh.id && f.task.line === li).length !== l.flight) bad++
      }
    for (const wk of site.workers) if (!Number.isFinite(wk.pose.x) || !Number.isFinite(wk.pose.z)) bad++
    for (const f of site.forklifts) if (!Number.isFinite(f.mv.pose.x) || !Number.isFinite(f.mv.pose.z)) bad++
  }
  return bad
}

const s0 = w.sites[0]
for (const k of ['urgent', 'surge', 'forkliftDown', 'truckDown'] as const) console.log(k, s0.triggerScenario(k, w.time).text)

const base = w.sites.map((s) => ({ done: s.stats.done, onTime: s.stats.onTime }))
let invBad = 0
const tStart = w.stepTime
let simMs = 0
for (let h = 0; h < HOURS; h++) {
  const t1 = performance.now()
  for (let k = 0; k < 3600; k++) {
    const a = performance.now()
    w.runTo(w.stepTime + 1)
    simMs += performance.now() - a
    w.sites.forEach((s, i) => {
      countOverlaps(truckPolys(s), tallies[i].truck, w.stepTime)
      countOverlaps(flPolys(s), tallies[i].fl, w.stepTime)
      trackStuck(s, w.stepTime)
    })
  }
  invBad += invariants()
  console.log(fmt(w.time), `(${Math.round(performance.now() - t1)}ms/h)`, report())
}

console.log('\n── 결과', `${fmt(tStart)} → ${fmt(w.stepTime)} (${HOURS}h)`)
w.sites.forEach((s, i) => {
  const done = s.stats.done - base[i].done
  const ok = s.stats.onTime - base[i].onTime
  const T = tallies[i]
  console.log(
    `${s.cfg.short}: 완료 ${done}건 (시간당 ${(done / HOURS).toFixed(1)}) 정시 ${done ? ((ok / done) * 100).toFixed(1) : '-'}% | 트럭 겹침 ${T.truck.events}건(${T.truck.steps}스텝) 지게차 겹침 ${T.fl.events}건(${T.fl.steps}스텝) | 양보 트럭 ${s.truckFleet.yields} 지게차 ${s.flFleet.yields}`,
  )
  for (const x of [...T.truck.samples, ...T.fl.samples]) console.log('   겹침', x)
})
console.log('invariant violations', invBad)
console.log(`최장 연속 정지 ${maxStop}s, ${STUCK_LIMIT}s 이상 ${longStops.length}건`)
for (const x of longStops.slice(0, 20)) console.log('   ', x)
console.log(`warmup ms ${Math.round(warmMs)} · sim ${Math.round(simMs / HOURS)}ms/h`)

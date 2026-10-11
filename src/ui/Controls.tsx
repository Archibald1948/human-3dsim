// 조작판: 도시(날씨·교통량·보행자)와 물류(물동량·지게차 투입·운영 도크) 조건을 바꾸면 3D와 지표가 따라 바뀐다
import { useState } from 'react'
import { useUi, world, type Weather } from '../store'

const WEATHERS: { v: Weather; label: string }[] = [
  { v: 'clear', label: '맑음' },
  { v: 'cloudy', label: '흐림' },
  { v: 'rain', label: '비' },
]

function Slider({ label, value, min, max, step, fmt, onChange }: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="ctl-row">
      <span className="ctl-name">{label}</span>
      <output className="ctl-val">{fmt(value)}</output>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ '--p': `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties} />
    </label>
  )
}

const pct = (v: number) => `${Math.round(v * 100)}%`

export function Controls() {
  useUi((s) => s.tick)
  const siteId = useUi((s) => s.siteId)
  const weather = useUi((s) => s.weather)
  const setWeather = useUi((s) => s.setWeather)
  const traffic = useUi((s) => s.traffic)
  const setTraffic = useUi((s) => s.setTraffic)
  const crowd = useUi((s) => s.crowd)
  const setCrowd = useUi((s) => s.setCrowd)
  const [busy, setBusy] = useState(false)
  const site = world.site(siteId)

  // 한 시간을 한꺼번에 계산한다 (세 센터를 1초 단위로 돌리므로 잠깐 걸린다)
  const skip = () => {
    setBusy(true)
    window.setTimeout(() => {
      world.runTo(world.time + 3600)
      setBusy(false)
    }, 30)
  }

  return (
    <section className="ctl" aria-label="조작판">
      <div className="panel-head">
        <h2>조작판</h2>
        <button type="button" className="ctl-skip" onClick={skip} disabled={busy}>
          {busy ? '계산 중' : '+1시간'}
        </button>
      </div>

      <div className="ctl-group">
        <h3>도시</h3>
        <div className="ctl-row">
          <span className="ctl-name">날씨</span>
          <div className="seg ctl-seg" role="radiogroup" aria-label="날씨">
            {WEATHERS.map((w) => (
              <button key={w.v} type="button" role="radio" aria-checked={weather === w.v} className={weather === w.v ? 'is-on' : ''} onClick={() => setWeather(w.v)}>
                {w.label}
              </button>
            ))}
          </div>
        </div>
        <Slider label="교통량" value={traffic} min={0.5} max={2} step={0.25} fmt={pct} onChange={setTraffic} />
        <Slider label="보행자" value={crowd} min={0.25} max={2} step={0.25} fmt={pct} onChange={setCrowd} />
      </div>

      <div className="ctl-group">
        <h3>물류 · {site.cfg.short}</h3>
        <Slider label="물동량" value={site.volume} min={0.5} max={2} step={0.1} fmt={pct} onChange={(v) => site.setVolume(v, world.time)} />
        <Slider label="지게차 투입" value={site.forkliftCap} min={1} max={site.forklifts.length} step={1} fmt={(v) => `${v} / ${site.forklifts.length}대`} onChange={(v) => site.setForkliftCap(v, world.time)} />
        <Slider label="운영 도크" value={site.dockCap} min={1} max={site.docks.length} step={1} fmt={(v) => `${v} / ${site.docks.length}개`} onChange={(v) => site.setDockCap(v, world.time)} />
      </div>
    </section>
  )
}

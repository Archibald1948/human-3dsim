import { useEffect, useMemo, useRef, useState } from 'react'
import type { Shipment, Site } from '../sim/engine'
import { sameSel, useUi, world } from '../store'
import { DIR_LABEL, fmtClock, shipStatusLabel } from './labels'

const BEFORE = 2 * 3600
const AFTER = 3 * 3600
type Filter = 'all' | 'in' | 'out' | 'late'

function isLate(s: Shipment, t: number) {
  if (s.onTime === false) return true
  if (s.dir === 'out' && s.doneAt == null && t > s.due) return true
  if (s.arrivedAt == null && t >= s.etaKnownAt && s.eta > s.winEnd) return true
  return false
}

export function Timeline() {
  useUi((s) => s.tick)
  const siteId = useUi((s) => s.siteId)
  const sel = useUi((s) => s.sel)
  const select = useUi((s) => s.select)
  const shown = useUi((s) => s.panels.tl)
  const [filter, setFilter] = useState<Filter>('all')
  const site: Site = world.site(siteId)
  const t = world.time
  const t0 = t - BEFORE
  const span = BEFORE + AFTER
  const pos = (x: number) => `${(((Math.max(t0, Math.min(t0 + span, x)) - t0) / span) * 100).toFixed(3)}%`
  const scroller = useRef<HTMLDivElement>(null)

  const rows = site.shipments
    .filter((s) => s.winEnd >= t0 && s.winStart <= t0 + span)
    .filter((s) => (filter === 'all' ? true : filter === 'late' ? isLate(s, t) : s.dir === filter))
    .sort((a, b) => a.winStart - b.winStart || a.id.localeCompare(b.id))

  const ticks = useMemo(() => {
    const out: number[] = []
    const first = Math.ceil(t0 / 3600) * 3600
    for (let h = first; h <= t0 + span; h += 3600) out.push(h)
    return out
    // 시간이 넘어갈 때만 다시 계산
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Math.floor(t0 / 3600), span])

  const counts = {
    all: site.shipments.filter((s) => s.winEnd >= t0 && s.winStart <= t0 + span).length,
    late: site.shipments.filter((s) => s.winEnd >= t0 && s.winStart <= t0 + span && isLate(s, t)).length,
  }

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const idx = rows.findIndex((s) => s.winEnd >= t - 900)
    el.scrollTop = Math.max(0, idx * 28 - 28)
    // 사이트/필터 변경 시에만 현재 시각 근처로 스크롤
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, filter])

  return (
    <section className="tl" aria-label="입출고 타임라인" inert={!shown}>
      <div className="tl-head">
        <div className="tl-title">
          <h2>입출고 타임라인</h2>
          <span className="muted">−2시간 ~ +3시간</span>
        </div>
        <div className="seg" role="tablist">
          {(
            [
              ['all', `전체 ${counts.all}`],
              ['in', '입고'],
              ['out', '출고'],
              ['late', `지연 ${counts.late}`],
            ] as [Filter, string][]
          ).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={filter === k} className={filter === k ? 'is-on' : ''} onClick={() => setFilter(k)}>
              {label}
            </button>
          ))}
        </div>
        <div className="tl-legend" aria-hidden="true">
          <span>
            <i className="lg lg-win" />
            예약 슬롯
          </span>
          <span>
            <i className="lg lg-wait" />
            야드 대기
          </span>
          <span>
            <i className="lg lg-svc" />
            도크 작업
          </span>
          <span>
            <i className="lg lg-eta" />
            GPS 도착 예정
          </span>
        </div>
      </div>
      <div className="tl-scroll" ref={scroller}>
        <div className="tl-inner">
          <div className="tl-axis">
            <div className="tl-axis-label" />
            <div className="tl-track">
              {ticks.map((h) => (
                <span key={h} className="tl-tick" style={{ left: pos(h) }}>
                  {fmtClock(h)}
                </span>
              ))}
              <span className="tl-now-label" style={{ left: pos(t) }}>
                {fmtClock(t)}
              </span>
            </div>
          </div>
          <div className="tl-rows">
            <div className="tl-gridlines" aria-hidden="true">
              <div className="tl-axis-label" />
              <div className="tl-track">
                {ticks.map((h) => (
                  <i key={h} style={{ left: pos(h) }} />
                ))}
                <b style={{ left: pos(t) }} />
              </div>
            </div>
            {rows.map((s) => {
              const late = isLate(s, t)
              const on = sameSel(sel, { kind: 'shipment', id: s.id }) || sameSel(sel, { kind: 'truck', id: s.truckId })
              const svcEnd = s.doneAt ?? t
              const prog = s.status === 'docked' ? (site.trucks.get(s.truckId)?.moved ?? 0) / s.pallets : 1
              return (
                <button key={s.id} type="button" className={`tl-row${on ? ' is-on' : ''}${s.status === 'done' ? ' is-done' : ''}`} onClick={() => select({ kind: 'shipment', id: s.id })}>
                  <span className="tl-label">
                    <span className={`dir dir--${s.dir}`}>{DIR_LABEL[s.dir]}</span>
                    <span className="tl-id">
                      {s.id}
                      {s.urgent && <em className="tl-urgent">긴급</em>}
                    </span>
                    <span className="tl-partner">{s.partner}</span>
                    <span className={`tl-st${late ? ' tone-crit' : ''}`}>{late ? '지연' : shipStatusLabel(s)}</span>
                  </span>
                  <span className="tl-track">
                    <i className="tl-win" style={{ left: pos(s.winStart), width: `calc(${pos(s.winEnd)} - ${pos(s.winStart)})` }} />
                    {s.dir === 'out' && <i className="tl-due" style={{ left: pos(s.due) }} />}
                    {s.arrivedAt != null && (
                      <i className="tl-wait" style={{ left: pos(s.arrivedAt), width: `calc(${pos(s.dockedAt ?? (s.status === 'done' ? s.arrivedAt : t))} - ${pos(s.arrivedAt)})` }} />
                    )}
                    {s.dockedAt != null && (
                      <i className={`tl-svc${late ? ' is-late' : ''}`} style={{ left: pos(s.dockedAt), width: `calc(${pos(svcEnd)} - ${pos(s.dockedAt)})` }}>
                        <b style={{ width: `${prog * 100}%` }} />
                      </i>
                    )}
                    {s.arrivedAt == null && t >= s.etaKnownAt && <i className={`tl-eta${s.eta > s.winEnd ? ' is-late' : ''}`} style={{ left: pos(s.eta) }} />}
                  </span>
                </button>
              )
            })}
            {!rows.length && <p className="muted tl-empty">해당 조건의 입출고가 없습니다.</p>}
          </div>
        </div>
      </div>
    </section>
  )
}

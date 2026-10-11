import { useUi, world } from '../store'
import { Spark } from './Spark'
import { Controls } from './Controls'
import { fmtClock } from './labels'

export function SidePanel() {
  useUi((s) => s.tick)
  const siteId = useUi((s) => s.siteId)
  const select = useUi((s) => s.select)
  const shown = useUi((s) => s.panels.side)
  const site = world.site(siteId)
  const t = world.time
  const k = site.kpis(t)
  const onTone = k.onTimePct >= 88 ? 'ok' : k.onTimePct >= 78 ? 'warn' : 'crit'

  return (
    <aside className="side" inert={!shown}>
      <Controls />
      <div className="panel-head panel-head--sub">
        <h2>운영 지표</h2>
        <span className="muted">오늘 누적</span>
      </div>

      <div className="kpis">
        <section className="kpi kpi--wide">
          <div className="kpi-main">
            <h3>정시 처리율</h3>
            <p className={`kpi-num tone-${onTone}`}>
              {k.onTimePct.toFixed(1)}
              <small>%</small>
            </p>
            <p className="kpi-sub">
              완료 {k.done}건 중 {k.onTime}건 기한 내
            </p>
          </div>
          <Spark data={k.hourly} />
        </section>

        <section className="kpi">
          <h3>도크 가동</h3>
          <p className="kpi-num">
            {k.occupied}
            <small> / {k.opDocks}</small>
          </p>
          <div className="dock-strip" aria-hidden="true">
            {site.docks.map((d) => (
              <i key={d.id} className={`ds ds--${site.dockState(d)}`} />
            ))}
          </div>
          <p className="kpi-sub">누적 가동률 {k.utilization.toFixed(0)}%</p>
        </section>

        <section className="kpi">
          <h3>트럭 대기장</h3>
          <p className={`kpi-num${k.yardCount >= k.yardCap - 3 ? ' tone-warn' : ''}`}>
            {k.yardCount}
            <small> / {k.yardCap}대</small>
          </p>
          <p className="kpi-sub">현재 평균 {k.avgWaitMin.toFixed(0)}분</p>
          <p className="kpi-sub">도착→접안 평균 {k.avgDwellMin.toFixed(0)}분</p>
        </section>

        <section className="kpi">
          <h3>오늘 처리량</h3>
          <p className="kpi-num">
            {(k.palletsIn + k.palletsOut).toLocaleString()}
            <small> PLT</small>
          </p>
          <p className="kpi-sub">
            입고 {k.palletsIn.toLocaleString()} · 출고 {k.palletsOut.toLocaleString()}
          </p>
        </section>

        <section className="kpi">
          <h3>재고 경고</h3>
          <p className="kpi-num">
            <span className={k.out ? 'tone-crit' : ''}>{k.out}</span>
            <small> 품절 · </small>
            <span className={k.low ? 'tone-warn' : ''}>{k.low}</span>
            <small> 부족</small>
          </p>
          <div className="meter" aria-label={`적재율 ${k.fillPct.toFixed(0)}%`}>
            <i style={{ width: `${k.fillPct}%` }} />
          </div>
          <p className="kpi-sub">랙 적재율 {k.fillPct.toFixed(0)}%</p>
        </section>

        <section className="kpi">
          <h3>현장 인원</h3>
          <p className="kpi-num">
            {k.onFloor}
            <small> / {k.crew}명</small>
          </p>
          <p className="kpi-sub">{k.onBreak ? `휴게 ${k.onBreak}명 · ` : ''}사무동 {k.crew - k.onFloor - k.onBreak}명</p>
        </section>

        <section className="kpi">
          <h3>지게차</h3>
          <p className="kpi-num">
            {k.flActive}
            <small> / {k.flTotal} 가동</small>
          </p>
          <p className={`kpi-sub${k.avgBattery < 40 ? ' tone-warn' : ''}`}>평균 배터리 {k.avgBattery.toFixed(0)}%</p>
          {k.flDown > 0 && <p className="kpi-sub tone-crit">고장 {k.flDown}대 정비 중</p>}
        </section>
      </div>

      <div className="panel-head panel-head--sub">
        <h2>실시간 알림</h2>
        <span className="muted">{site.events.length}건</span>
      </div>
      <ol className="alerts">
        {site.events.slice(0, 40).map((e) => (
          <li key={e.id}>
            <button type="button" className={`alert alert--${e.level}`} disabled={!e.ref} onClick={() => e.ref && select(e.ref)}>
              <time>{fmtClock(e.t)}</time>
              <i />
              <span>{e.text}</span>
            </button>
          </li>
        ))}
      </ol>
    </aside>
  )
}

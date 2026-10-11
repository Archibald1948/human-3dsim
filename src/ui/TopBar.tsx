import { SPEEDS, useUi, world, type PanelKey } from '../store'
import { fmtClock, fmtDate } from './labels'

function tone(pct: number) {
  return pct >= 88 ? 'ok' : pct >= 78 ? 'warn' : 'crit'
}

// 패널 접기 버튼: 창 테두리 안에서 해당 패널 자리를 칠하면 보임, 비우면 숨김
const PANEL_BTNS: { key: PanelKey; label: string; strip: { x: number; y: number; w: number; h: number }; line: string }[] = [
  { key: 'side', label: '왼쪽 조작판', strip: { x: 2, y: 3, w: 4, h: 10 }, line: 'M6.25 3v10' },
  { key: 'tl', label: '아래 타임라인', strip: { x: 2, y: 9, w: 12, h: 4 }, line: 'M2 8.75h12' },
  { key: 'insp', label: '오른쪽 상세', strip: { x: 10, y: 3, w: 4, h: 10 }, line: 'M9.75 3v10' },
]

function PanelToggles() {
  const panels = useUi((s) => s.panels)
  const toggle = useUi((s) => s.togglePanel)
  const setAll = useUi((s) => s.setAllPanels)
  // 하나라도 보이면 모두 닫고, 모두 닫혀 있으면 모두 연다
  const any = panels.side || panels.insp || panels.tl
  return (
    <div className="panel-toggles" role="group" aria-label="패널 보이기">
      <button type="button" className="pt-all" aria-label={any ? '모든 패널 닫기' : '모든 패널 열기'} title={any ? '모든 패널 닫기' : '모든 패널 열기'} onClick={() => setAll(!any)}>
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          {any ? (
            <path d="M5 5l6 6M11 5l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          ) : (
            <path d="M5.5 2.5H2.5v3M10.5 2.5h3v3M5.5 13.5H2.5v-3M10.5 13.5h3v-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          )}
        </svg>
      </button>
      {PANEL_BTNS.map(({ key, label, strip, line }) => (
        <button key={key} type="button" aria-pressed={panels[key]} aria-label={`${label} 패널`} title={`${label} ${panels[key] ? '숨기기' : '보이기'}`} onClick={() => toggle(key)}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <rect className="pt-strip" x={strip.x} y={strip.y} width={strip.w} height={strip.h} />
            <path d={line} stroke="currentColor" strokeWidth="1.3" />
            <rect x="1.65" y="2.65" width="12.7" height="10.7" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </button>
      ))}
    </div>
  )
}

export function TopBar() {
  useUi((s) => s.tick)
  const siteId = useUi((s) => s.siteId)
  const setSite = useUi((s) => s.setSite)
  const speed = useUi((s) => s.speed)
  const setSearchOpen = useUi((s) => s.setSearchOpen)
  const setSpeed = useUi((s) => s.setSpeed)
  const t = world.time

  return (
    <header className="topbar">
      <div className="brand">
        <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="1" y="1" width="22" height="22" rx="5" fill="currentColor" />
          <path d="M6 17V8M10 17V8M6 10.5h4M6 14h4M14 17V8M18 17V8M14 10.5h4M14 14h4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <div className="brand-text">
          <strong>Hubline</strong>
          <span>창고 관제</span>
        </div>
      </div>

      <nav className="sites" aria-label="사이트 선택">
        {world.sites.map((s) => {
          const k = s.kpis(t)
          return (
            <button key={s.cfg.id} type="button" className={`site-tab${s.cfg.id === siteId ? ' is-on' : ''}`} onClick={() => setSite(s.cfg.id)}>
              <i className={`dot dot--${tone(k.onTimePct)}`} />
              <span className="site-name">{s.cfg.name}</span>
              <span className="site-short">{s.cfg.short}</span>
              <span className="site-kpi">{k.onTimePct.toFixed(0)}%</span>
            </button>
          )
        })}
      </nav>

      <button type="button" className="search-btn" onClick={() => setSearchOpen(true)}>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="m10.5 10.5 3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <span>검색</span>
        <kbd>⌘K</kbd>
      </button>

      <div className="clock-group">
        <div className="clock" aria-live="off">
          <span className="live">LIVE</span>
          <span className="clock-date">{fmtDate(world.day0, t)}</span>
          <strong className="clock-time">{fmtClock(t, true)}</strong>
        </div>
        <div className="speed" role="group" aria-label="시뮬레이션 속도">
          {SPEEDS.map((s) => (
            <button key={s} type="button" className={speed === s ? 'is-on' : ''} onClick={() => setSpeed(s)} title={`실제 1초 = ${s}초`}>
              {s}×
            </button>
          ))}
        </div>
        <PanelToggles />
      </div>
    </header>
  )
}

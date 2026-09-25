import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from '../router'
import { useStore } from '../store'
import { SeatGrid } from '../components/SeatGrid'
import { ArrowLeft, Printer } from 'lucide-react'
import type { ClassEntity } from '../types'
import { SHEET_GAP_MM, packWeek } from '../lib/pagination'
import type { PrintChunk, WeekMeasure } from '../lib/pagination'

function SheetHead({ cls, week, pageInWeek, pagesInWeek, globalIndex, totalPages }: {
  cls: ClassEntity
  week: number
  pageInWeek: number
  pagesInWeek: number
  globalIndex: number
  totalPages: number
}) {
  return (
    <header className="print-head">
      <h2>
        {cls.name} · 第 {week} 周座位表
        {pageInWeek > 1 && <em className="print-cont-tag">续 {pageInWeek}/{pagesInWeek}</em>}
      </h2>
      <span className="print-date">
        {pagesInWeek > 1 && `第 ${week} 周 ${pageInWeek}/${pagesInWeek} · 总第 ${globalIndex + 1}/${totalPages} 页 · `}
        生成于 {new Date(cls.updatedAt).toLocaleDateString('zh-CN')}
      </span>
    </header>
  )
}

function SheetFoot({ pageInWeek, pagesInWeek }: { pageInWeek: number; pagesInWeek: number }) {
  return (
    <footer className="print-foot">
      <span>▲ 上方为讲台方向 · 左右按教室实际门窗方向标注</span>
      <span>
        标记说明：<b>前排</b>=近视照顾 <b>中间</b>=视力需中间 <b>听力</b>=听力照顾 <b>过道</b>=行动不便照顾 <b>T1/T2/T3</b>=学习分层
      </span>
      {pagesInWeek > 1 && (
        <span className="print-cont-note">
          本周座位表共 {pagesInWeek} 页，本页为第 {pageInWeek}/{pagesInWeek} 页{pageInWeek < pagesInWeek ? '，下接续页' : '（续页完）'}
        </span>
      )}
    </footer>
  )
}

export function Print({ classId }: { classId: string }) {
  const { getClass } = useStore()
  const cls = getClass(classId)
  const weeks = cls?.assignments.length ?? 0

  const [checked, setChecked] = useState<Set<number>>(
    () => new Set(Array.from({ length: weeks }, (_, i) => i + 1)),
  )
  const [rangeStart, setRangeStart] = useState(1)
  const [rangeEnd, setRangeEnd] = useState(weeks)
  const [measures, setMeasures] = useState<Record<number, WeekMeasure>>({})
  const measureRef = useRef<HTMLDivElement>(null)

  // 班级或周数变化（重新生成会增删周）时恢复默认：全部勾选、区间为第 1~最后一周
  useEffect(() => {
    setChecked(new Set(Array.from({ length: weeks }, (_, i) => i + 1)))
    setRangeStart(1)
    setRangeEnd(weeks)
  }, [classId, weeks])

  // 用隐藏的「打印同宽」容器实测每周在 A4 上的排高，据此决定每周需要几页、在哪里续页
  useLayoutEffect(() => {
    if (!cls || weeks === 0) return
    let cancelled = false
    const measure = () => {
      const host = measureRef.current
      if (!host || cancelled) return
      const probe = host.querySelector<HTMLElement>('[data-mm-probe]')
      const pxPerMm = probe && probe.offsetWidth > 0 ? probe.offsetWidth / 100 : 96 / 25.4
      const next: Record<number, WeekMeasure> = {}
      host.querySelectorAll<HTMLElement>('[data-measure-week]').forEach((sheet) => {
        const w = Number(sheet.dataset.measureWeek)
        const canvas = sheet.querySelector<HTMLElement>('.seat-canvas')
        const foot = sheet.querySelector<HTMLElement>('.print-foot')
        if (!canvas || !foot) return
        const sheetTop = sheet.getBoundingClientRect().top
        const canvasTop = canvas.getBoundingClientRect().top - sheetTop
        const canvasAbsTop = canvas.getBoundingClientRect().top
        // 各排上沿/下沿（相对网格顶部）
        const tops: number[] = []
        const bottoms: number[] = []
        canvas.querySelectorAll<HTMLElement>('[data-row]').forEach((seat) => {
          const r = Number(seat.dataset.row)
          const rect = seat.getBoundingClientRect()
          tops[r] = Math.min(tops[r] ?? Number.POSITIVE_INFINITY, rect.top - canvasAbsTop)
          bottoms[r] = Math.max(bottoms[r] ?? 0, rect.bottom - canvasAbsTop)
        })
        for (let r = 1; r < bottoms.length; r++) {
          if (!Number.isFinite(tops[r])) tops[r] = tops[r - 1]
          if (!bottoms[r]) bottoms[r] = bottoms[r - 1]
        }
        next[w] = {
          rowTops: tops,
          rowBottoms: bottoms,
          // canvasTop 已含「标题头 + 一处间隙 + 讲台条 + 图前间隙」；
          // 再补「图后间隙 + 页脚」
          fixedH: canvasTop + SHEET_GAP_MM * pxPerMm + foot.offsetHeight,
        }
      })
      if (!cancelled) setMeasures(next)
    }
    measure()
    // 字体异步加载完成后排高可能变化，加载后再测一次
    document.fonts?.ready?.then(() => {
      if (!cancelled) measure()
    })
    return () => {
      cancelled = true
    }
  }, [cls, weeks])

  const selectedWeeks = useMemo(
    () => Array.from({ length: weeks }, (_, i) => i + 1).filter((w) => checked.has(w)),
    [weeks, checked],
  )
  const inRange = (w: number) => w >= rangeStart && w <= rangeEnd
  const effectiveWeeks = selectedWeeks.filter(inRange)

  // 每周切页结果（按实测高度；首帧未测完时先按一周一页占位）
  const chunksByWeek = useMemo(() => {
    const probe = measureRef.current?.querySelector<HTMLElement>('[data-mm-probe]')
    const pxPerMm = probe && probe.offsetWidth > 0 ? probe.offsetWidth / 100 : 96 / 25.4
    const map = new Map<number, PrintChunk[]>()
    effectiveWeeks.forEach((w) => {
      map.set(w, packWeek(w, cls?.layout.rows ?? 0, measures[w], pxPerMm))
    })
    return map
  }, [effectiveWeeks, measures, cls])

  const pages = useMemo(
    () => effectiveWeeks.flatMap((w) => chunksByWeek.get(w) ?? []),
    [effectiveWeeks, chunksByWeek],
  )
  const totalPages = pages.length
  const overflowWeeks = effectiveWeeks.filter((w) => (chunksByWeek.get(w)?.length ?? 1) > 1)

  if (!cls) {
    return (
      <div className="page">
        <p>班级不存在。</p>
        <Link to="/">返回</Link>
      </div>
    )
  }

  const toggleWeek = (w: number, on: boolean) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (on) next.add(w)
      else next.delete(w)
      return next
    })
  }

  const selectAll = () => setChecked(new Set(Array.from({ length: weeks }, (_, i) => i + 1)))
  const clearAll = () => setChecked(new Set())
  const applyRange = () => {
    const lo = Math.min(Math.max(rangeStart, 1), weeks)
    const hi = Math.min(Math.max(rangeEnd, 1), weeks)
    const [s, e] = lo <= hi ? [lo, hi] : [hi, lo]
    setRangeStart(s)
    setRangeEnd(e)
    setChecked(new Set(Array.from({ length: e - s + 1 }, (_, i) => s + i)))
  }

  return (
    <div className="page page-wide">
      <div className="print-toolbar no-print">
        <Link className="back" to={`/class/${cls.id}/rotations`}>
          <ArrowLeft size={14} /> 返回轮换
        </Link>
        <h1>{cls.name} · 打印座位表</h1>

        <div className="row-flex">
          <span className="label">周次区间</span>
          <label className="inline-label">
            起始
            <input
              className="input input-sm week-num"
              type="number" min={1} max={Math.max(weeks, 1)}
              data-testid="print-range-start"
              value={rangeStart}
              onChange={(e) => setRangeStart(Number(e.target.value))}
            />
          </label>
          <label className="inline-label">
            结束
            <input
              className="input input-sm week-num"
              type="number" min={1} max={Math.max(weeks, 1)}
              data-testid="print-range-end"
              value={rangeEnd}
              onChange={(e) => setRangeEnd(Number(e.target.value))}
            />
          </label>
          <button className="btn btn-sm" data-testid="print-apply-range" onClick={applyRange} disabled={weeks === 0}>
            按区间勾选
          </button>
          <button className="btn btn-sm" onClick={selectAll} disabled={weeks === 0}>
            全选
          </button>
          <button className="btn btn-sm" onClick={clearAll} disabled={weeks === 0}>
            清空
          </button>
          <button
            className="btn btn-primary"
            data-testid="do-print"
            onClick={() => window.print()}
            disabled={weeks === 0 || totalPages === 0}
          >
            <Printer size={15} /> 打印（A4 纵向）
          </button>
        </div>

        {weeks > 0 && (
          <fieldset className="print-week-picker">
            <legend>勾选要打印的周次（默认全选；勾选但落在区间外的周次不会打印）</legend>
            <div className="print-week-list">
              {Array.from({ length: weeks }, (_, i) => i + 1).map((w) => {
                const outOfRange = !inRange(w)
                // 区间外保留勾选状态但禁用：调回区间内时选择不丢
                const on = checked.has(w)
                return (
                  <label
                    key={w}
                    className={`week-check${outOfRange ? ' week-check-out' : ''}${on && !outOfRange ? ' week-check-on' : ''}`}
                    title={outOfRange ? `第 ${w} 周不在第 ${rangeStart}–${rangeEnd} 周区间内，不会打印` : undefined}
                  >
                    <input
                      type="checkbox"
                      data-testid={`print-week-${w}`}
                      checked={on}
                      disabled={outOfRange}
                      onChange={(e) => toggleWeek(w, e.target.checked)}
                    />
                    第 {w} 周
                  </label>
                )
              })}
            </div>
          </fieldset>
        )}

        {weeks === 0 ? (
          <p className="muted">还没有生成轮换结果，无法打印。先到「轮换结果」页生成。</p>
        ) : (
          <div className="print-summary card" data-testid="print-summary">
            <div>
              <b data-testid="print-total-pages">共 {totalPages} 页</b>
              <span className="muted small">
                {' '}· 已勾选 {selectedWeeks.length} 周{selectedWeeks.length !== effectiveWeeks.length ? `，区间内 ${effectiveWeeks.length} 周` : ''}
              </span>
              {totalPages === 0 && <span className="bad small"> · 当前没有可打印的周次，请勾选周次或调整区间</span>}
            </div>
            {totalPages > 0 && (
              <ol className="print-page-list">
                {pages.map((p, i) => (
                  <li key={`${p.week}-${p.pageInWeek}`}>
                    <a href={`#print-anchor-${p.week}-${p.pageInWeek}`} data-testid={`print-page-link-${i + 1}`}>
                      第 {i + 1} 页 · 第 {p.week} 周{p.pagesInWeek > 1 ? ` ${p.pageInWeek}/${p.pagesInWeek}` : ''}
                    </a>
                  </li>
                ))}
              </ol>
            )}
            {overflowWeeks.length > 0 && (
              <p className="muted small" data-testid="print-overflow-note">
                座位图较高的周次已自动续页：{overflowWeeks.map((w) => `第 ${w} 周（${chunksByWeek.get(w)?.length} 页）`).join('、')}
                ；续页同样带讲台方向条、周次页码与标记说明。
              </p>
            )}
          </div>
        )}
      </div>

      {pages.map((p, i) => {
        const asg = cls.assignments.find((a) => a.week === p.week)
        if (!asg) return null
        const isLast = i === pages.length - 1
        return (
          <div
            key={`${p.week}-${p.pageInWeek}`}
            id={`print-anchor-${p.week}-${p.pageInWeek}`}
            className={`print-sheet${isLast ? ' print-page-last' : ''}`}
            data-testid={p.pageInWeek === 1 ? `print-sheet-${p.week}` : `print-sheet-${p.week}-p${p.pageInWeek}`}
            data-print-week={p.week}
            data-print-page={p.pageInWeek}
          >
            <SheetHead
              cls={cls}
              week={p.week}
              pageInWeek={p.pageInWeek}
              pagesInWeek={p.pagesInWeek}
              globalIndex={i}
              totalPages={totalPages}
            />
            <SeatGrid cls={cls} assignment={asg} compact rowRange={{ start: p.startRow, end: p.endRow }} />
            <SheetFoot pageInWeek={p.pageInWeek} pagesInWeek={p.pagesInWeek} />
          </div>
        )
      })}

      {/* 隐藏的实测层：按打印真实宽度（194mm、无页边距）渲染每一周，供分页计算 */}
      {weeks > 0 && (
        <div className="print-measure-host" ref={measureRef} aria-hidden="true">
          <div data-mm-probe style={{ width: '100mm' }} />
          {cls.assignments.map((asg) => (
            <div className="print-sheet print-measure" key={asg.week} data-measure-week={asg.week}>
              {/* 故意按「续页」最坏情况渲染标题/页脚，保证测出的固定开销偏大不偏小 */}
              <SheetHead cls={cls} week={asg.week} pageInWeek={2} pagesInWeek={2} globalIndex={1} totalPages={2} />
              <SeatGrid cls={cls} assignment={asg} compact />
              <SheetFoot pageInWeek={1} pagesInWeek={2} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

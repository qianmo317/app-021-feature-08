import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from '../router'
import { useStore } from '../store'
import { SeatGrid } from '../components/SeatGrid'
import type { Assignment, ClassEntity } from '../types'
import { chunkRows, type RowChunk as Chunk } from '../lib/pagination'
import { ArrowLeft, Printer } from 'lucide-react'

// A4 纵向：210mm × 297mm，@page margin 8mm → 可打印区 194mm × 281mm
const A4_CONTENT_WIDTH_MM = 194
const A4_CONTENT_HEIGHT_MM = 281
// 留一点安全余量，避免浏览器/字体差异导致溢出半行
const PAGE_SAFE_MM = 4

// ============ 分页探测：用与打印完全一致的隐藏页实测每排高度，贪心分页 ============

interface ProbeMeasure {
  week: number
  chunks: Chunk[]
}

function WeekProbe({
  cls,
  assignment,
  onMeasured,
}: {
  cls: ClassEntity
  assignment: Assignment
  onMeasured: (m: ProbeMeasure) => void
}) {
  const sheetRef = useRef<HTMLDivElement>(null)

  const measure = useCallback(() => {
    const sheet = sheetRef.current
    if (!sheet) return
    const head = sheet.querySelector<HTMLElement>('.print-head:not(.print-head-cont)')
    const contHead = sheet.querySelector<HTMLElement>('.print-head-cont')
    const foot = sheet.querySelector<HTMLElement>('.print-foot')
    const seatmap = sheet.querySelector<HTMLElement>('.seatmap')
    const canvas = sheet.querySelector<HTMLElement>('.seat-canvas')
    if (!head || !contHead || !foot || !seatmap || !canvas) return

    // 1mm 折算的 CSS 像素数（随系统打印缩放变化）
    const pxPerMm = sheet.getBoundingClientRect().width / A4_CONTENT_WIDTH_MM
    if (!pxPerMm || pxPerMm === Infinity) return
    const pageBudget = (A4_CONTENT_HEIGHT_MM - PAGE_SAFE_MM) * pxPerMm

    // computed style 的长度一律已换算为 px
    const gapPx = (el: Element): number => parseFloat(getComputedStyle(el).gap) || 0
    const sheetGap = gapPx(sheet) // 6mm：页眉↔座位图、座位图↔页脚，共 2 处
    const seatmapGap = gapPx(seatmap) // 8px：讲台条↔座位网格，1 处
    const canvasGap = parseFloat(getComputedStyle(canvas).rowGap) || 0
    const headH = head.getBoundingClientRect().height
    const contHeadH = contHead.getBoundingClientRect().height
    const footH = foot.getBoundingClientRect().height
    const stageH = (canvas.previousElementSibling?.getBoundingClientRect().height ?? 0) + seatmapGap

    // 除座位网格行之外，每页固定占用的高度（首页与续页仅页眉高度不同）
    const fixedH = (h: number) => h + footH + stageH + 2 * sheetGap

    // 每一排座位行的高度（取该行最高座位，加行间 gap）
    const rowHeights: number[] = []
    for (const seat of Array.from(canvas.querySelectorAll<HTMLElement>('[data-seat-id]'))) {
      const r = Number(seat.dataset.row)
      const h = seat.getBoundingClientRect().height
      rowHeights[r] = Math.max(rowHeights[r] ?? 0, h)
    }
    if (!rowHeights.length) return

    const chunks = chunkRows(
      rowHeights,
      (pageIndex) => pageBudget - fixedH(pageIndex === 0 ? headH : contHeadH),
      canvasGap,
    )
    onMeasured({ week: assignment.week, chunks })
  }, [assignment.week, onMeasured])

  useLayoutEffect(measure)
  useEffect(() => {
    // 字体加载完成后排高可能变化，重测一次（父组件按内容去重）
    let alive = true
    document.fonts?.ready.then(() => {
      if (alive) measure()
    })
    return () => {
      alive = false
    }
  }, [measure])

  return (
    <div className="print-sheet print-sheet-probe" ref={sheetRef} aria-hidden="true">
      <header className="print-head">
        <h2>{cls.name} · 第 {assignment.week} 周座位表</h2>
        <span className="print-date">生成于 {new Date(cls.updatedAt).toLocaleDateString('zh-CN')}</span>
      </header>
      {/* 续页页眉（探测用，绝对定位只量高度不占布局）；文案取最长可能形式 */}
      <header className="print-head print-head-cont">
        <h2>
          {cls.name} · 第 {assignment.week} 周座位表
          <span className="cont-tag">续上页（第 99–99 排）</span>
        </h2>
        <span className="print-head-right">
          <span className="print-page-no">
            第 {assignment.week} 周 99/99
          </span>
        </span>
      </header>
      <SeatGrid cls={cls} assignment={assignment} compact />
      <footer className="print-foot">
        <span>▲ 上方为讲台方向 · 左右按教室实际门窗方向标注</span>
        <span>
          标记说明：<b>前排</b>=近视照顾 <b>中间</b>=视力需中间 <b>听力</b>=听力照顾 <b>过道</b>=行动不便照顾{' '}
          <b>T1/T2/T3</b>=学习分层
        </span>
      </footer>
    </div>
  )
}

// ============ 单张打印页（一个物理页 = 一周的一个分页块） ============

function PrintPage({
  cls,
  assignment,
  chunk,
  pageInWeek,
  pagesInWeek,
}: {
  cls: ClassEntity
  assignment: Assignment
  chunk: Chunk
  pageInWeek: number
  pagesInWeek: number
}) {
  const cont = pageInWeek > 1
  return (
    <div
      className="print-sheet"
      data-testid={`print-sheet-${assignment.week}-${pageInWeek}`}
      data-week={assignment.week}
      data-page-in-week={pageInWeek}
      data-pages-in-week={pagesInWeek}
    >
      <header className={cont ? 'print-head print-head-cont' : 'print-head'}>
        <h2>
          {cls.name} · 第 {assignment.week} 周座位表
          {cont && (
            <span className="cont-tag">
              续上页（第 {chunk.fromRow + 1}–{chunk.toRow} 排）
            </span>
          )}
        </h2>
        <span className="print-head-right">
          <span className="print-page-no">
            第 {assignment.week} 周 {pageInWeek}/{pagesInWeek}
          </span>
          {!cont && <span className="print-date">生成于 {new Date(cls.updatedAt).toLocaleDateString('zh-CN')}</span>}
        </span>
      </header>
      <SeatGrid cls={cls} assignment={assignment} compact rowRange={[chunk.fromRow, chunk.toRow]} />
      <footer className="print-foot">
        <span>▲ 上方为讲台方向 · 左右按教室实际门窗方向标注</span>
        <span>
          标记说明：<b>前排</b>=近视照顾 <b>中间</b>=视力需中间 <b>听力</b>=听力照顾 <b>过道</b>=行动不便照顾{' '}
          <b>T1/T2/T3</b>=学习分层
        </span>
      </footer>
    </div>
  )
}

// ============ 打印页 ============

export function Print({ classId }: { classId: string }) {
  const { getClass } = useStore()
  const cls = getClass(classId)

  const allWeeks: number[] = useMemo(() => (cls ? cls.assignments.map((a) => a.week) : []), [cls])
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  const [startWeek, setStartWeek] = useState(1)
  const [endWeek, setEndWeek] = useState(1)
  const [chunksByWeek, setChunksByWeek] = useState<Map<number, Chunk[]>>(new Map())

  // 教室布局或学生名单变化会改变每排高度，作废已有分页实测结果
  const layoutKey = cls
    ? `${cls.layout.rows}x${cls.layout.cols}-${cls.layout.aisles.join('.')}-${cls.students.length}`
    : ''
  useEffect(() => {
    setChunksByWeek((prev) => (prev.size === 0 ? prev : new Map()))
  }, [layoutKey])

  // 默认全选；班级轮换变化后补齐/收缩
  useEffect(() => {
    if (allWeeks.length === 0) return
    setSelected((prev) => {
      if (allWeeks.every((w) => prev.has(w))) return prev
      return new Set(allWeeks)
    })
    setStartWeek((s) => (allWeeks.includes(s) ? s : allWeeks[0]))
    setEndWeek((e) => (allWeeks.includes(e) ? e : allWeeks[allWeeks.length - 1]))
  }, [allWeeks])

  if (!cls) {
    return (
      <div className="page">
        <p>班级不存在。</p>
        <Link to="/">返回</Link>
      </div>
    )
  }

  const weeks = cls.assignments.length
  const weeksEmpty = weeks === 0

  const toggleWeek = (w: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(w)) next.delete(w)
      else next.add(w)
      return next
    })
  }

  const selectAll = () => setSelected(new Set(allWeeks))
  const clearAll = () => setSelected(new Set())

  // 起止周：应用为闭区间勾选；起始周超过结束周时把结束周拉齐，反之亦然
  const applyStart = (w: number) => {
    const hi = Math.max(endWeek, w)
    setStartWeek(w)
    setEndWeek(hi)
    setSelected(new Set(allWeeks.filter((x) => x >= w && x <= hi)))
  }
  const applyEnd = (w: number) => {
    const lo = Math.min(startWeek, w)
    setStartWeek(lo)
    setEndWeek(w)
    setSelected(new Set(allWeeks.filter((x) => x >= lo && x <= w)))
  }

  const onMeasured = useCallback((m: ProbeMeasure) => {
    setChunksByWeek((prev) => {
      const old = prev.get(m.week)
      if (old && old.length === m.chunks.length && old.every((c, i) => c.fromRow === m.chunks[i].fromRow && c.toRow === m.chunks[i].toRow)) {
        return prev
      }
      const next = new Map(prev)
      next.set(m.week, m.chunks)
      return next
    })
  }, [])

  // 探针串行：一次只挂载一个隐藏页实测（避免 20 周同时渲染拖慢页面）
  const [probeWeek, setProbeWeek] = useState<number | null>(null)
  const selectedWeeks = useMemo(() => allWeeks.filter((w) => selected.has(w)), [allWeeks, selected])
  // 某周实测入库后，自动把探针推进到下一个未实测的勾选周
  useEffect(() => {
    setProbeWeek((cur) => {
      if (cur != null && selectedWeeks.includes(cur) && !chunksByWeek.has(cur)) return cur
      return selectedWeeks.find((w) => !chunksByWeek.has(w)) ?? null
    })
  }, [selectedWeeks, chunksByWeek])

  const probeAssignment = probeWeek != null ? cls.assignments.find((a) => a.week === probeWeek) : undefined

  // 展开成物理页列表：未完成实测的周先按一周一页占位
  const pages = useMemo(() => {
    const assignmentByWeek = new Map(cls.assignments.map((a) => [a.week, a]))
    const out: { week: number; assignment: Assignment; chunks: Chunk[] }[] = []
    for (const week of allWeeks) {
      if (!selected.has(week)) continue
      const assignment = assignmentByWeek.get(week)!
      const chunks = chunksByWeek.get(week) ?? [{ fromRow: 0, toRow: cls.layout.rows }]
      out.push({ week, assignment, chunks })
    }
    return out
  }, [cls, allWeeks, selected, chunksByWeek])

  const totalPages = pages.reduce((n, p) => n + p.chunks.length, 0)
  const planSummary = pages.map((p) =>
    p.chunks.length > 1 ? `第${p.week}周×${p.chunks.length}页` : `第${p.week}周`,
  )

  return (
    <div className="page page-wide">
      <div className="print-toolbar no-print">
        <Link className="back" to={`/class/${cls.id}/rotations`}>
          <ArrowLeft size={14} /> 返回轮换
        </Link>
        <h1>{cls.name} · 打印座位表</h1>

        <fieldset className="week-picker" data-testid="week-picker" disabled={weeksEmpty}>
          <legend>勾选要打印的周次（默认全选）</legend>
          <div className="week-picker-actions">
            <button type="button" className="btn btn-sm" onClick={selectAll} data-testid="week-select-all">
              全选
            </button>
            <button type="button" className="btn btn-sm" onClick={clearAll} data-testid="week-select-none">
              清空
            </button>
            <label className="inline-label">
              起始周
              <select
                className="input input-sm"
                value={startWeek}
                data-testid="week-start"
                onChange={(e) => applyStart(Number(e.target.value))}
              >
                {allWeeks.map((w) => (
                  <option key={w} value={w}>
                    第 {w} 周
                  </option>
                ))}
              </select>
            </label>
            <label className="inline-label">
              结束周
              <select
                className="input input-sm"
                value={endWeek}
                data-testid="week-end"
                onChange={(e) => applyEnd(Number(e.target.value))}
              >
                {allWeeks.map((w) => (
                  <option key={w} value={w}>
                    第 {w} 周
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="week-chip-list">
            {allWeeks.map((w) => (
              <label key={w} className={`week-chip${selected.has(w) ? ' week-chip-on' : ''}`}>
                <input type="checkbox" checked={selected.has(w)} onChange={() => toggleWeek(w)} />
                第 {w} 周
              </label>
            ))}
          </div>
        </fieldset>

        <div className="row-flex print-toolbar-side">
          <span className="print-plan" data-testid="print-plan">
            共 <b data-testid="print-total-pages">{totalPages}</b> 页（{totalPages} 张 A4）
            {selected.size > 0 && <span className="print-plan-detail">：{planSummary.join('、')}</span>}
          </span>
          <button
            className="btn btn-primary"
            data-testid="do-print"
            onClick={() => window.print()}
            disabled={weeksEmpty || selected.size === 0}
          >
            <Printer size={15} /> 打印（A4 纵向）
          </button>
        </div>
        {weeksEmpty && <p className="muted">还没有生成轮换结果，无法打印。先到「轮换结果」页生成。</p>}
        {!weeksEmpty && selected.size === 0 && <p className="muted">请至少勾选一个周次再打印。</p>}
      </div>

      {/* 打印前预览：每个物理页标注「周次 · 第几页/共几页」，多页周可看到续页 */}
      <ol className="print-plan-list no-print" data-testid="print-plan-list">
        {pages.map((p) =>
          p.chunks.map((_, i) => (
            <li key={`${p.week}-${i}`} data-testid={`print-plan-item-${p.week}-${i + 1}`}>
              {i === 0 ? `第 ${p.week} 周` : `第 ${p.week} 周（续）`} · {i + 1}/{p.chunks.length}
            </li>
          )),
        )}
      </ol>

      {/* 分页实测探针：屏幕上始终只有一张与打印等宽的隐藏页，逐周串行实测 */}
      {probeAssignment && (
        <div className="print-probe-host no-print" aria-hidden="true">
          <WeekProbe key={probeAssignment.week} cls={cls} assignment={probeAssignment} onMeasured={onMeasured} />
        </div>
      )}

      {/* 实际打印内容 */}
      {pages.map((p) =>
        p.chunks.map((chunk, i) => (
          <PrintPage
            key={`${p.week}-${i}`}
            cls={cls}
            assignment={p.assignment}
            chunk={chunk}
            pageInWeek={i + 1}
            pagesInWeek={p.chunks.length}
          />
        )),
      )}
    </div>
  )
}

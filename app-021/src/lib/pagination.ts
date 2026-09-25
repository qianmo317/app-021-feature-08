// 打印分页：按座位图实测高度把某一周的排切成若干页（每页至少一排，放不下自动续页）

// A4 纵向 210×297mm，@page 四边各 8mm → 可用 194×281mm；再留 2mm 安全余量防浏览器取整溢出
export const PAGE_BUDGET_MM = 279
// .print-sheet 的 flex gap（标题与图、图与页脚之间）
export const SHEET_GAP_MM = 6

export interface WeekMeasure {
  /** 各排相对完整座位网格顶部的上沿（px） */
  rowTops: number[]
  /** 各排相对完整座位网格顶部的下沿（px） */
  rowBottoms: number[]
  /** 每页固定开销：标题头 + 讲台条 + 页脚 + 各处间隙（px，不含座位网格本身） */
  fixedH: number
}

export interface PrintChunk {
  week: number
  startRow: number
  endRow: number
  pageInWeek: number
  pagesInWeek: number
}

/**
 * 按实测高度贪心切页：从第一排起，只要下一排加进来仍不超出本页可打印高度就继续塞，
 * 塞不下就续页。每页至少保留一排（即使单排超高也不拆排）。
 */
export function packWeek(week: number, rows: number, m: WeekMeasure | undefined, pxPerMm: number): PrintChunk[] {
  if (!m || m.rowBottoms.length === 0) {
    return [{ week, startRow: 0, endRow: rows - 1, pageInWeek: 1, pagesInWeek: 1 }]
  }
  const canvasBudget = PAGE_BUDGET_MM * pxPerMm - m.fixedH
  const chunks: PrintChunk[] = []
  let start = 0
  while (start < rows) {
    let end = start
    while (end + 1 < rows && m.rowBottoms[end + 1] - m.rowTops[start] <= canvasBudget) {
      end++
    }
    chunks.push({ week, startRow: start, endRow: end, pageInWeek: 1, pagesInWeek: 1 })
    start = end + 1
  }
  chunks.forEach((c, i) => {
    c.pageInWeek = i + 1
    c.pagesInWeek = chunks.length
  })
  return chunks
}

/** 构造均匀排高的实测数据（测试/预估用）：rowHeightMm 为每排含间距的高度 */
export function uniformMeasure(rows: number, rowHeightMm: number, fixedMm: number, pxPerMm: number): WeekMeasure {
  const rowTops: number[] = []
  const rowBottoms: number[] = []
  for (let r = 0; r < rows; r++) {
    rowTops.push(r * rowHeightMm * pxPerMm)
    rowBottoms.push((r + 1) * rowHeightMm * pxPerMm)
  }
  return { rowTops, rowBottoms, fixedH: fixedMm * pxPerMm }
}

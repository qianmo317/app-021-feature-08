// 打印页按排分页：把一周的座位行贪心切成若干个 A4 物理页。
// 纯函数版本与 src/pages/Print.tsx 中 WeekProbe 的实测切排逻辑保持一致，便于单测。

export interface RowChunk {
  fromRow: number // 0-based，含
  toRow: number // 0-based，不含
}

/**
 * @param rowHeights 每一排座位行的高度（px，取该行最高座位）
 * @param budgetOf 第 pageIndex 页留给座位网格的高度（px，= 页高 - 页眉 - 讲台条 - 页脚）；
 *                 首页与续页页眉高度不同，因此按页号取值
 * @param rowGap 座位行之间的 gap（px）
 */
export function chunkRows(rowHeights: number[], budgetOf: (pageIndex: number) => number, rowGap: number): RowChunk[] {
  const chunks: RowChunk[] = []
  let start = 0
  while (start < rowHeights.length) {
    const budget = budgetOf(chunks.length)
    let used = 0
    let end = start
    while (end < rowHeights.length) {
      const extra = rowHeights[end] + (end > start ? rowGap : 0)
      if (used + extra > budget && end > start) break
      used += extra
      end++
      // 单排就超出一页：也只占一页（避免死循环，实际靠打印字号压缩兜底）
      if (used >= budget) break
    }
    chunks.push({ fromRow: start, toRow: end })
    start = end
  }
  return chunks
}

// DOM 测试环境（happy-dom）：happy-dom 声明了 indexedDB 但未实现，强制回退到内存存储
import { vi } from 'vitest'

if (typeof window !== 'undefined') {
  try {
    vi.stubGlobal('indexedDB', undefined)
  } catch {
    // 某些版本只读，忽略
  }
}

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Query-then-Push 訂閱的 race 修補：訂閱先行、push 先到者勝。
// 舊模式「query().then(render) 之後才 subscribe」有兩個 race：
// 1. query 完成前抵達的 push 沒人接（漏更新）
// 2. push 先到、較舊的 query 結果後到 → 覆蓋新資料
// liveQuery 先掛訂閱；query 結果只在尚未收到任何 push 時套用。
// 回傳 query 完成的 promise，供「初載後才做」的後續動作（如 pending detail 消費）。

export function liveQuery<T>(
  query: () => Promise<T>,
  subscribe: (cb: (v: T) => void) => void,
  onData: (v: T) => void,
): Promise<void> {
  let pushed = false
  subscribe((v) => {
    pushed = true
    onData(v)
  })
  return query().then((v) => {
    if (!pushed) onData(v)
  })
}

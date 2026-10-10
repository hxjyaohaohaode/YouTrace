// Dedicated non-evictable shared-key budget. Unrelated auth/IP limit buckets
// cannot reset it. Intentionally single-process; restarts reset usage history.
export class ServerAIBudget {
  private hourStart = 0
  private hourCount = 0
  private active = 0
  private users = new Map<string, { start: number; count: number }>()

  acquire(userId: string, now = Date.now()): (() => void) | null {
    if (this.active >= 2) return null
    if (now >= this.hourStart + 60 * 60 * 1000) {
      this.hourStart = now; this.hourCount = 0; this.users.clear()
    }
    if (this.hourCount >= 60) return null
    const old = this.users.get(userId)
    const user = !old || now >= old.start + 60000 ? { start: now, count: 0 } : old
    if (user.count >= 20) return null
    user.count += 1; this.users.set(userId, user)
    this.hourCount += 1; this.active += 1
    let released = false
    return () => { if (!released) { released = true; this.active -= 1 } }
  }
}

export interface SessionData {
  /** Caller-chosen session ID. */
  id: string;
  /** UUID of the Qwen Code session behind it. */
  qwenSessionId: string;
  /** Directory the Qwen session was created in; resume only works from there. */
  cwd: string;
  createdAt: Date;
  lastAccessedAt: Date;
  turns: number;
}

/** In-memory map from caller session IDs to Qwen Code sessions. */
export class InMemorySessionStorage {
  private sessions = new Map<string, SessionData>();

  constructor(
    private readonly maxSessions = 100,
    private readonly sessionTtl = 24 * 60 * 60 * 1000
  ) {}

  get(sessionId: string): SessionData | undefined {
    this.cleanupExpired();
    return this.sessions.get(sessionId);
  }

  /** Record a completed turn, creating the mapping on the first one. */
  recordTurn(sessionId: string, qwenSessionId: string, cwd: string): void {
    const now = new Date();
    const existing = this.sessions.get(sessionId);
    if (existing && existing.qwenSessionId === qwenSessionId) {
      existing.turns += 1;
      existing.lastAccessedAt = now;
      return;
    }
    this.sessions.set(sessionId, {
      id: sessionId,
      qwenSessionId,
      cwd,
      createdAt: now,
      lastAccessedAt: now,
      turns: 1,
    });
    this.enforceMax();
  }

  delete(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  list(): SessionData[] {
    this.cleanupExpired();
    return Array.from(this.sessions.values()).sort(
      (a, b) => b.lastAccessedAt.getTime() - a.lastAccessedAt.getTime()
    );
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.lastAccessedAt.getTime() > this.sessionTtl) {
        this.sessions.delete(id);
      }
    }
  }

  private enforceMax(): void {
    if (this.sessions.size <= this.maxSessions) return;
    for (const session of this.list().slice(this.maxSessions)) {
      this.sessions.delete(session.id);
    }
  }
}

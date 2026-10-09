/** Estimates the server clock, so every client counts down to the same start */
export class ServerClock {
  private offset = 0;
  private bestRtt = Infinity;

  /** Milliseconds on the server's clock */
  now = (): number => performance.timeOrigin + performance.now() + this.offset;

  /** A few round trips to /api/time; the fastest one is the most accurate */
  async sync(samples = 5) {
    for (let i = 0; i < samples; i++) {
      const sent = performance.timeOrigin + performance.now();
      try {
        const response = await fetch("/api/time", { cache: "no-store" });
        const { t } = (await response.json()) as { t: number };
        const received = performance.timeOrigin + performance.now();
        const rtt = received - sent;
        if (rtt <= this.bestRtt) {
          this.bestRtt = rtt;
          this.offset = t + rtt / 2 - received;
        }
      } catch {
        // Keep the estimate we have
      }
    }
  }

  get roundTripMs(): number {
    return this.bestRtt;
  }
}

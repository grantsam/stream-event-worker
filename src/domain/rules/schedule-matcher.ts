export interface ActiveWindow {
  days: readonly number[];
  startMinutes: number;
  endMinutes: number;
}

const isoWeekday: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

export class ScheduleMatcher {
  private readonly formatter: Intl.DateTimeFormat;

  constructor(
    private readonly timeZone: string,
    private readonly windows: readonly ActiveWindow[],
  ) {
    this.formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  }

  matches(epochMs: number): boolean {
    const parts = Object.fromEntries(
      this.formatter
        .formatToParts(epochMs)
        .map((part) => [part.type, part.value]),
    );
    const day = isoWeekday[parts.weekday ?? ''];
    const minutes = Number(parts.hour) * 60 + Number(parts.minute);
    if (!day || !Number.isFinite(minutes)) return false;

    return this.windows.some((window) => {
      if (window.startMinutes <= window.endMinutes) {
        return (
          window.days.includes(day) &&
          minutes >= window.startMinutes &&
          minutes <= window.endMinutes
        );
      }
      const previousDay = day === 1 ? 7 : day - 1;
      return (
        (window.days.includes(day) && minutes >= window.startMinutes) ||
        (window.days.includes(previousDay) && minutes <= window.endMinutes)
      );
    });
  }

  ready(): boolean {
    return this.timeZone.length > 0 && this.windows.length > 0;
  }
}

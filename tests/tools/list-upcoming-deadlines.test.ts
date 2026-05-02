import { describe, it, expect, vi } from "vitest";
import { listUpcomingDeadlinesTool } from "../../src/tools/list-upcoming-deadlines.js";

describe("list_upcoming_deadlines tool", () => {
  it("calls search with deadlineBefore = now + withinDays", async () => {
    const search = {
      search: vi.fn(async () => ({ tenders: [], warnings: [] })),
    };
    const ctx = {
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      search,
    } as unknown as Parameters<typeof listUpcomingDeadlinesTool.handler>[1];

    await listUpcomingDeadlinesTool.handler({ withinDays: 14 }, ctx);
    const call = (search.search as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      deadlineBefore?: string;
    };
    expect(call.deadlineBefore).toBeDefined();
    const deadlineDate = new Date(call.deadlineBefore!);
    const now = Date.now();
    const days = (deadlineDate.getTime() - now) / 86_400_000;
    expect(days).toBeGreaterThan(13);
    expect(days).toBeLessThan(15);
  });

  it("defaults withinDays to 14 if not provided", async () => {
    const search = { search: vi.fn(async () => ({ tenders: [], warnings: [] })) };
    const ctx = {
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      search,
    } as unknown as Parameters<typeof listUpcomingDeadlinesTool.handler>[1];
    await listUpcomingDeadlinesTool.handler({}, ctx);
    expect(search.search).toHaveBeenCalled();
  });
});

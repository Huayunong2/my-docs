import { describe, expect, it } from "vitest";
import { DailyRecordSession } from "./dailyRecordSession";
import type { Article } from "./api";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function article(date: string, content: string): Article {
  return { id: date, date, title: date, content, mood: "", tags: [], word_count: content.length, created_at: "", updated_at: "" };
}

describe("DailyRecordSession", () => {
  it("does not apply an old save after a newer edit has been saved", async () => {
    const first = deferred<Article>();
    const second = deferred<Article>();
    let call = 0;
    const started: string[] = [];
    const session = new DailyRecordSession({
      create: (draft) => {
        started.push(draft.content);
        return ++call === 1 ? first.promise : second.promise;
      },
      update: () => Promise.reject(new Error("not used")),
    });
    session.begin("2026-07-16", null);

    session.markEdited();
    const oldSave = session.save({ date: "2026-07-16", title: "", content: "old", mood: "", tags: [] });
    await Promise.resolve();
    session.markEdited();
    const newSave = session.save({ date: "2026-07-16", title: "", content: "new", mood: "", tags: [] });
    expect(started).toEqual(["old"]);
    first.resolve(article("2026-07-16", "old"));
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual(["old", "new"]);
    second.resolve(article("2026-07-16", "new"));

    expect((await oldSave).applied).toBe(false);
    expect((await newSave).applied).toBe(true);
    expect(session.article?.content).toBe("new");
  });

  it("ignores a load or save response from the previous date", async () => {
    const pending = deferred<Article>();
    const session = new DailyRecordSession({
      create: () => pending.promise,
      update: () => pending.promise,
    });
    const oldGeneration = session.begin("2026-07-15", null);
    session.markEdited();
    const save = session.save({ date: "2026-07-15", title: "", content: "old", mood: "", tags: [] });
    session.begin("2026-07-16", null);
    pending.resolve(article("2026-07-15", "old"));

    expect(session.acceptLoaded(oldGeneration, article("2026-07-15", "loaded"))).toBe(false);
    expect((await save).applied).toBe(false);
    expect(session.article).toBeNull();
  });

  it("does not let a late load overwrite edits made while loading", () => {
    const session = new DailyRecordSession({
      create: () => Promise.reject(new Error("not used")),
      update: () => Promise.reject(new Error("not used")),
    });
    const generation = session.begin("2026-07-16", null);
    session.markEdited();

    expect(session.acceptLoaded(generation, article("2026-07-16", "late load"))).toBe(false);
    expect(session.article).toBeNull();
  });

  it("invalidates an in-flight save when the record is deleted", async () => {
    const pending = deferred<Article>();
    const session = new DailyRecordSession({
      create: () => pending.promise,
      update: () => pending.promise,
    });
    session.begin("2026-07-16", article("2026-07-16", "saved"));
    session.markEdited();
    const save = session.save({ date: "2026-07-16", title: "", content: "pending", mood: "", tags: [] });
    session.clear();
    pending.resolve(article("2026-07-16", "pending"));

    expect((await save).applied).toBe(false);
    expect(session.article).toBeNull();
  });
});

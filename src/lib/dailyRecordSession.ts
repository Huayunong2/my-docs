import type { Article } from "./api";

export interface DailyRecordDraft {
  date: string;
  title: string;
  content: string;
  mood: string;
  tags: string[];
}

export interface DailyRecordPort {
  create(draft: DailyRecordDraft): Promise<Article>;
  update(id: string, draft: Omit<DailyRecordDraft, "date">): Promise<Article>;
}

export type SaveResult =
  | { applied: true; article: Article }
  | { applied: false; article: null };

export class DailyRecordSession {
  article: Article | null = null;
  private generation = 0;
  private editRevision = 0;
  private requestRevision = 0;
  private date = "";
  private readonly port: DailyRecordPort;
  private saveTail: Promise<void> = Promise.resolve();

  constructor(port: DailyRecordPort) {
    this.port = port;
  }

  begin(date: string, article: Article | null): number {
    this.generation += 1;
    this.editRevision = 0;
    this.requestRevision = 0;
    this.saveTail = Promise.resolve();
    this.date = date;
    this.article = article;
    return this.generation;
  }

  acceptLoaded(generation: number, article: Article | null): boolean {
    if (generation !== this.generation || this.editRevision !== 0 || this.requestRevision !== 0) return false;
    this.article = article;
    return true;
  }

  markEdited(): void {
    this.editRevision += 1;
  }

  clear(): void {
    this.generation += 1;
    this.editRevision = 0;
    this.requestRevision = 0;
    this.saveTail = Promise.resolve();
    this.article = null;
  }

  whenIdle(): Promise<void> {
    return this.saveTail;
  }

  async save(draft: DailyRecordDraft): Promise<SaveResult> {
    const generation = this.generation;
    const editRevision = this.editRevision;
    const requestRevision = ++this.requestRevision;
    const previousSave = this.saveTail;
    let releaseSave!: () => void;
    this.saveTail = new Promise<void>((resolve) => { releaseSave = resolve; });
    await previousSave;
    const isStale = () => generation !== this.generation
      || draft.date !== this.date
      || editRevision !== this.editRevision
      || requestRevision !== this.requestRevision;
    if (isStale()) {
      releaseSave();
      return { applied: false, article: null };
    }
    const existing = this.article;
    let article: Article;
    try {
      article = existing
        ? await this.port.update(existing.id, {
            title: draft.title,
            content: draft.content,
            mood: draft.mood,
            tags: draft.tags,
          })
        : await this.port.create(draft);
    } catch (error) {
      releaseSave();
      if (isStale()) return { applied: false, article: null };
      throw error;
    }
    releaseSave();
    const applied = !isStale();
    if (!applied) return { applied: false, article: null };
    this.article = article;
    return { applied: true, article };
  }
}

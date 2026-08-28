import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import { refreshKnowledgeMetadata } from "./knowledgeMetadata";

afterEach(() => vi.restoreAllMocks());

describe("refreshKnowledgeMetadata", () => {
  it("reads fresh tag and space data after a card changes its relationships", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(api.knowledgeQueryKeys.tags, [{ tag: "旧标签", count: 1 }]);
    queryClient.setQueryData(api.knowledgeQueryKeys.projects, [{ name: "旧空间", count: 1, total_count: 1 }]);

    const freshTags = [{ tag: "新标签", count: 2 }];
    const freshSpaces = [{ name: "C++", count: 2, total_count: 2, article_count: 0, kind: "topic" as const, status: "active" as const }];
    vi.spyOn(api, "listKnowledgeTags").mockResolvedValue(freshTags);
    vi.spyOn(api, "listSpaces").mockResolvedValue(freshSpaces);

    const result = await refreshKnowledgeMetadata(queryClient);

    expect(result).toEqual({ tags: freshTags, projects: freshSpaces });
    expect(queryClient.getQueryData(api.knowledgeQueryKeys.tags)).toEqual(freshTags);
    expect(queryClient.getQueryData(api.knowledgeQueryKeys.projects)).toEqual(freshSpaces);
  });
});

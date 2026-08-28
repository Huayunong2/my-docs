import type { QueryClient } from "@tanstack/react-query";
import * as api from "./api";

export async function refreshKnowledgeMetadata(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: api.knowledgeQueryKeys.tags }),
    queryClient.invalidateQueries({ queryKey: api.knowledgeQueryKeys.projects }),
  ]);

  const [tags, projects] = await Promise.all([
    queryClient.fetchQuery({
      queryKey: api.knowledgeQueryKeys.tags,
      queryFn: ({ signal }) => api.listKnowledgeTags({ signal }),
      staleTime: 0,
    }),
    queryClient.fetchQuery({
      queryKey: api.knowledgeQueryKeys.projects,
      queryFn: ({ signal }) => api.listSpaces({ signal }),
      staleTime: 0,
    }),
  ]);

  return { tags, projects };
}

import {
  DEFAULT_USER_CONFIGURATION,
  fetchUserConfiguration,
  updateUserConfiguration,
  type UserConfiguration,
} from "@jellyfuse/api";
import { queryKeys, STALE_TIMES } from "@jellyfuse/query-keys";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { apiFetchAuthenticated } from "@/services/api/client";
import { useAuth } from "@/services/auth/state";

/**
 * Read the server-persisted `UserConfiguration` for the active Jellyfin
 * user. Scoped by `userId` like every other per-user query — on user
 * switch `clearQueryCacheExceptAuth` wipes this key along with the rest
 * of the per-user data.
 *
 * Returns `DEFAULT_USER_CONFIGURATION` on `data === undefined` only when
 * the caller passes `fallback: true`; by default the raw `UseQueryResult`
 * is returned so callers can render a loading state before data lands.
 * Prefer `useUserConfigurationOrDefault` as a convenience wrapper when
 * you want a settled shape to read from.
 */
export function useUserConfiguration(): UseQueryResult<UserConfiguration> {
  const { serverUrl, activeUser } = useAuth();
  const userId = activeUser?.userId;
  return useQuery({
    queryKey: queryKeys.userConfiguration(userId ?? ""),
    queryFn: ({ signal }) => {
      if (!serverUrl || !userId) {
        throw new Error("useUserConfiguration called without full auth context");
      }
      return fetchUserConfiguration({ baseUrl: serverUrl, userId }, apiFetchAuthenticated, signal);
    },
    enabled: Boolean(serverUrl && userId),
    staleTime: STALE_TIMES.userConfiguration,
  });
}

/**
 * Convenience wrapper returning a settled `UserConfiguration` — either
 * the server copy or the defaults. The loading-state flags are still
 * exposed so a screen can show a spinner on first load, while the
 * resolver/player reads (which don't care about the source) can rely on
 * `config` always being defined.
 */
export function useUserConfigurationOrDefault(): {
  config: UserConfiguration;
  isPending: boolean;
  isError: boolean;
} {
  const query = useUserConfiguration();
  return {
    config: query.data ?? DEFAULT_USER_CONFIGURATION,
    isPending: query.isPending,
    isError: query.isError,
  };
}

export interface UpdateUserConfigurationArgs {
  /**
   * Partial patch over the current config. The mutation reads the
   * current cache entry, applies the patch, and POSTs the whole shape
   * back to Jellyfin (the server endpoint replaces the record, not a
   * partial update — see `packages/api/src/user-config.ts`).
   */
  patch: Partial<UserConfiguration>;
}

/**
 * Mutation that patches one-or-more fields of the server-persisted
 * `UserConfiguration`. Optimistic: the cache is updated before the
 * network round-trip so the Settings screen picker snaps immediately.
 * On error the previous snapshot is restored.
 */
export function useUpdateUserConfiguration(): UseMutationResult<
  UserConfiguration,
  Error,
  UpdateUserConfigurationArgs,
  { previous: UserConfiguration | undefined }
> {
  const queryClient = useQueryClient();
  const { serverUrl, activeUser } = useAuth();
  const userId = activeUser?.userId;
  const key = queryKeys.userConfiguration(userId ?? "");

  return useMutation({
    mutationFn: async ({ patch }: UpdateUserConfigurationArgs): Promise<UserConfiguration> => {
      if (!serverUrl || !userId) {
        throw new Error("useUpdateUserConfiguration called without full auth context");
      }
      // Always send the full shape — Jellyfin's endpoint replaces the
      // record wholesale, so missing fields would be reset to defaults.
      const current =
        queryClient.getQueryData<UserConfiguration>(key) ?? DEFAULT_USER_CONFIGURATION;
      const next: UserConfiguration = { ...current, ...patch };
      await updateUserConfiguration(
        { baseUrl: serverUrl, userId, config: next },
        apiFetchAuthenticated,
      );
      return next;
    },
    onMutate: async ({ patch }) => {
      // Optimistically apply the patch so UI reflects the change
      // instantly. Snapshot the previous value so `onError` can roll
      // back without a network round-trip.
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<UserConfiguration>(key);
      const base = previous ?? DEFAULT_USER_CONFIGURATION;
      queryClient.setQueryData<UserConfiguration>(key, { ...base, ...patch });
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context) {
        queryClient.setQueryData<UserConfiguration | undefined>(key, context.previous);
      }
    },
    onSuccess: (next) => {
      // Reseat the cache with the server-confirmed shape — the
      // optimistic copy and server copy should match, but the server
      // may have normalised fields (e.g. empty string → null).
      queryClient.setQueryData<UserConfiguration>(key, next);
    },
  });
}

import { useQuery } from "@tanstack/react-query";
import { getDeviceId } from "@/services/device-id";

/**
 * Resolves the stable device id via React Query — async native call
 * goes through the query cache instead of `useEffect + useState`, per
 * the project rule (see memory: feedback_no_async_useeffect and
 * https://react.dev/learn/you-might-not-need-an-effect).
 *
 * The id is cached forever (`staleTime: Infinity`) because it's
 * literally immutable for the process — `getDeviceId` memoises
 * internally and the underlying native identifier never changes for
 * the lifetime of the app install.
 */
export function useDeviceId(): string | undefined {
  const query = useQuery({
    queryKey: ["device-id"] as const,
    queryFn: getDeviceId,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 0,
  });
  return query.data;
}

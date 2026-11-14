import type { NetworkStatusSnapshot } from './types';

export interface NetworkProbe {
  getConnectionInfo(): {
    online: boolean;
    effectiveType: NetworkStatusSnapshot['effectiveType'];
    rttMs: number | null;
    downlinkMbps: number | null;
    saveData: boolean;
  };
  checkCloudReachability(): Promise<{
    reachable: boolean;
    latencyMs: number | null;
  }>;
}

export async function monitorNetworkStatus(
  probe: NetworkProbe
): Promise<NetworkStatusSnapshot> {
  const conn = probe.getConnectionInfo();

  if (!conn.online) {
    return {
      online: false,
      effectiveType: conn.effectiveType,
      rttMs: conn.rttMs,
      downlinkMbps: conn.downlinkMbps,
      saveData: conn.saveData,
      cloudReachable: false,
      cloudHealthLatencyMs: null,
    };
  }

  const cloudCheck = await probe.checkCloudReachability();

  return {
    online: conn.online,
    effectiveType: conn.effectiveType,
    rttMs: conn.rttMs,
    downlinkMbps: conn.downlinkMbps,
    saveData: conn.saveData,
    cloudReachable: cloudCheck.reachable,
    cloudHealthLatencyMs: cloudCheck.latencyMs,
  };
}

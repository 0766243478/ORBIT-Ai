import type {
  DeviceCapabilityProfile,
  DeviceTier,
  LocalAvailabilityState,
} from './types';

export interface DeviceProbe {
  getHardwareInfo(): {
    platform: DeviceCapabilityProfile['platform'];
    browserName: string;
    deviceMemoryGb: number | null;
    hardwareConcurrency: number | null;
    webGpuAvailable: boolean;
  };
  getStorageQuotaMb(): Promise<number | null>;
  getLocalModelStatus(): Promise<{
    apiPresent: boolean;
    availability: LocalAvailabilityState;
    reason: string;
  }>;
}

export interface TierAssessment {
  deviceTier: DeviceTier;
  recommendedMaxLocalTokens: number;
  allowWarmSessionCache: boolean;
  advisories: string[];
}

export function classifyDeviceTier(
  deviceMemoryGb: number | null,
  hardwareConcurrency: number | null,
  webGpuAvailable: boolean,
  storageQuotaMb: number | null
): TierAssessment {
  const advisories: string[] = [];

  if (
    (deviceMemoryGb !== null && deviceMemoryGb <= 2) ||
    (hardwareConcurrency !== null && hardwareConcurrency <= 2)
  ) {
    return {
      deviceTier: 'low_2gb',
      recommendedMaxLocalTokens: 0,
      allowWarmSessionCache: false,
      advisories: [
        'Low-end hardware tier: on-device weights and cached sessions disabled to protect tab memory.',
      ],
    };
  }

  if (deviceMemoryGb !== null && deviceMemoryGb <= 4) {
    advisories.push(
      'Entry-level 3–4 GB RAM tier: local inference capped at 1,536 context tokens with immediate session release.'
    );
    if (!webGpuAvailable) {
      advisories.push('WebGPU unavailable on entry hardware; higher latency expected for local tokens.');
    }
    return {
      deviceTier: 'entry_3_4gb',
      recommendedMaxLocalTokens: 1536,
      allowWarmSessionCache: false,
      advisories,
    };
  }

  if (deviceMemoryGb !== null && deviceMemoryGb <= 6) {
    if (!webGpuAvailable) {
      advisories.push('WebGPU unavailable; capping local context to 2,048 tokens.');
    }
    return {
      deviceTier: 'mid_6gb',
      recommendedMaxLocalTokens: webGpuAvailable ? 3072 : 2048,
      allowWarmSessionCache: webGpuAvailable,
      advisories,
    };
  }

  if (deviceMemoryGb !== null && deviceMemoryGb > 6) {
    if (!webGpuAvailable) {
      advisories.push('WebGPU acceleration unavailable; CPU/fallback inference may run slower.');
    }
    if (storageQuotaMb !== null && storageQuotaMb < 4096) {
      advisories.push(
        `Browser storage quota (${Math.round(storageQuotaMb)} MB) is below 4,096 MB recommended for multi-GB Nano weights.`
      );
    }
    return {
      deviceTier: 'high_8gb_plus',
      recommendedMaxLocalTokens: webGpuAvailable ? 4096 : 2560,
      allowWarmSessionCache: true,
      advisories,
    };
  }

  // Fallback when navigator.deviceMemory is hidden (Safari, Firefox, privacy browsers)
  if (hardwareConcurrency !== null && hardwareConcurrency <= 4) {
    return {
      deviceTier: 'entry_3_4gb',
      recommendedMaxLocalTokens: 1536,
      allowWarmSessionCache: false,
      advisories: [
        'Device memory unreported; using conservative entry-tier limits (1,536 tokens, no pinned session cache).',
      ],
    };
  }

  return {
    deviceTier: 'unknown',
    recommendedMaxLocalTokens: webGpuAvailable ? 3072 : 2048,
    allowWarmSessionCache: webGpuAvailable,
    advisories,
  };
}

export function evaluateResourceConstraints(
  deviceMemoryGb: number | null,
  hardwareConcurrency: number | null,
  storageQuotaMb: number | null
): { constrained: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (deviceMemoryGb !== null && deviceMemoryGb <= 2) {
    reasons.push(`Low reported device memory (${deviceMemoryGb} GB).`);
  }
  if (hardwareConcurrency !== null && hardwareConcurrency <= 2) {
    reasons.push(`Limited CPU concurrency (${hardwareConcurrency} cores).`);
  }
  if (storageQuotaMb !== null && storageQuotaMb < 512) {
    reasons.push(`Low available browser storage quota (${Math.round(storageQuotaMb)} MB).`);
  }

  return {
    constrained: reasons.length > 0,
    reasons,
  };
}

export async function profileDeviceCapabilities(
  probe: DeviceProbe
): Promise<DeviceCapabilityProfile> {
  const hw = probe.getHardwareInfo();
  const [storageQuotaMb, localStatus] = await Promise.all([
    probe.getStorageQuotaMb(),
    probe.getLocalModelStatus(),
  ]);

  const { constrained, reasons } = evaluateResourceConstraints(
    hw.deviceMemoryGb,
    hw.hardwareConcurrency,
    storageQuotaMb
  );

  const tier = classifyDeviceTier(
    hw.deviceMemoryGb,
    hw.hardwareConcurrency,
    hw.webGpuAvailable,
    storageQuotaMb
  );

  const combinedReasons = [...reasons];
  if (
    localStatus.availability === 'downloadable' &&
    storageQuotaMb !== null &&
    storageQuotaMb < 4096
  ) {
    combinedReasons.push(
      `Storage quota (${Math.round(storageQuotaMb)} MB) may be insufficient to download on-device Nano weights (~1.7–4 GB).`
    );
  }

  return {
    platform: hw.platform,
    browserName: hw.browserName,
    deviceMemoryGb: hw.deviceMemoryGb,
    hardwareConcurrency: hw.hardwareConcurrency,
    webGpuAvailable: hw.webGpuAvailable,
    storageQuotaMb,
    localApiPresent: localStatus.apiPresent,
    localModelAvailability: localStatus.availability,
    localModelReason: localStatus.reason,
    resourceConstrained: constrained,
    constraintReasons: combinedReasons,
    deviceTier: tier.deviceTier,
    recommendedMaxLocalTokens: tier.recommendedMaxLocalTokens,
    allowWarmSessionCache: tier.allowWarmSessionCache,
  };
}

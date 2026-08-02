/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Presentation-only metadata for Kubernetes conditions.
 *
 * These helpers do NOT change condition data. They only decide how to render
 * the Status column of a conditions table: what colour and icon to show, and
 * a plain-English tooltip explaining what the condition means.
 */

import { StatusLabelProps } from './Label';

export type ConditionPolarity = 'positive' | 'negative' | 'neutral';

// "Good when True" — these types indicate a healthy state when status=True.
const POSITIVE_CONDITIONS = new Set<string>([
  'Available',
  'Ready',
  'Progressing',
  'Initialized',
  'ContainersReady',
  'PodScheduled',
  'PodReadyToStartContainers',
  'Established',
  'NamesAccepted',
  'KubeletReady',
  'NetworkReady',
  'Healthy',
  'Synced',
  'Reconciled',
  'Approved',
  'Accepted',
  'Resolved',
  'ScalingActive',
]);

// "Bad when True" — these types indicate an unhealthy state when status=True.
const NEGATIVE_CONDITIONS = new Set<string>([
  'ReplicaFailure',
  'MemoryPressure',
  'DiskPressure',
  'PIDPressure',
  'NetworkUnavailable',
  'FrequentUnregisterNetDevice',
  'FrequentContainerdRestart',
  'FrequentDockerRestart',
  'FrequentKubeletRestart',
  'CorruptDockerOverlay2',
  'KernelDeadlock',
  'ReadonlyFilesystem',
  'OutOfDisk',
  'ContainersNotReady',
  'ContainersNotInitialized',
  'Failed',
  'Degraded',
  'Stalled',
  'ScalingLimited',
]);

export function getConditionPolarity(type: string): ConditionPolarity {
  if (POSITIVE_CONDITIONS.has(type)) return 'positive';
  if (NEGATIVE_CONDITIONS.has(type)) return 'negative';
  return 'neutral';
}

/**
 * Chooses the StatusLabel colour ("kind") for a given condition based on
 * polarity + status. Unknown / missing status is treated as warning.
 */
export function getConditionStatusKind(type: string, status: string): StatusLabelProps['status'] {
  if (!status || status === 'Unknown') return 'warning';

  const polarity = getConditionPolarity(type);
  if (polarity === 'positive') {
    return status === 'True' ? 'success' : 'error';
  }
  if (polarity === 'negative') {
    return status === 'True' ? 'error' : 'success';
  }
  // Neutral / unknown polarity: colour only when True, otherwise keep it neutral.
  return status === 'True' ? 'success' : '';
}

/**
 * Icon name (iconify) that visually reinforces the status kind. Used alongside
 * colour so the meaning is still legible for colour-blind users.
 */
export function getConditionStatusIcon(kind: StatusLabelProps['status']): string {
  switch (kind) {
    case 'success':
      return 'mdi:check-circle';
    case 'error':
      return 'mdi:close-circle';
    case 'warning':
      return 'mdi:alert-circle';
    default:
      return 'mdi:minus-circle-outline';
  }
}

// Reason → friendly explanation. Keyed by reason string (case-sensitive, as k8s emits).
const FRIENDLY_BY_REASON: Record<string, string> = {
  MinimumReplicasUnavailable: 'Not enough healthy pods to serve traffic',
  MinimumReplicasAvailable: 'Enough healthy pods are serving traffic',
  NewReplicaSetAvailable: 'A new replica set is available',
  NewReplicaSetCreated: 'A new replica set was created for the rollout',
  ReplicaSetUpdated: 'Rollout is in progress',
  ProgressDeadlineExceeded: 'Rollout gave up — progress deadline exceeded',
  DeploymentPaused: 'Rollout is paused',
  DeploymentResumed: 'Rollout has been resumed',
  FailedCreate: 'Failed to create pods',
  FailedDelete: 'Failed to delete pods',
  SuccessfulCreate: 'Pods were created successfully',
  SuccessfulDelete: 'Pods were deleted successfully',
  ContainersNotReady: 'One or more containers are not ready',
  ContainersNotInitialized: 'One or more init containers have not completed',
  PodCompleted: 'Pod finished successfully',
  Unschedulable: 'Pod cannot be scheduled onto any node',
  KubeletReady: 'Node kubelet is ready',
  KubeletNotReady: 'Node kubelet is not ready',
  KubeletHasSufficientMemory: 'Node has sufficient memory',
  KubeletHasNoDiskPressure: 'Node has sufficient disk space',
  KubeletHasSufficientPID: 'Node has sufficient PIDs available',
  NodeHasSufficientMemory: 'Node has sufficient memory',
  NodeHasNoDiskPressure: 'Node has sufficient disk space',
  NodeHasSufficientPID: 'Node has sufficient PIDs available',
  NodeStatusUnknown: 'Node status has not been reported recently',
  RouteCreated: 'Route was created',
  ReadyForNewScale: 'Autoscaler is ready to compute a new scale',
  TooFewReplicas: 'Desired replica count is below the configured minimum',
  TooManyReplicas: 'Desired replica count is above the configured maximum',
  ScalingActive: 'Autoscaler is actively adjusting the replica count',
  FailedGetResourceMetric: 'Autoscaler could not fetch resource metrics',
};

// Fallback: type|status → friendly explanation when reason is missing or unmapped.
const FRIENDLY_BY_TYPE_STATUS: Record<string, string> = {
  'Available|True': 'The resource has enough healthy pods to serve traffic',
  'Available|False': 'The resource does not have enough healthy pods to serve traffic',
  'Progressing|True': 'Rollout is progressing normally',
  'Progressing|False': 'Rollout has stopped making progress',
  'Ready|True': 'The resource is ready',
  'Ready|False': 'The resource is not ready',
  'ReplicaFailure|True': 'One or more replicas failed to be created',
  'ReplicaFailure|False': 'No replica creation failures',
  'ContainersReady|True': 'All containers in the pod are ready',
  'ContainersReady|False': 'One or more containers are not ready',
  'PodScheduled|True': 'The pod has been scheduled onto a node',
  'PodScheduled|False': 'The pod has not yet been scheduled onto a node',
  'Initialized|True': 'All init containers have completed successfully',
  'Initialized|False': 'Init containers have not completed',
  'MemoryPressure|True': 'The node is running low on memory',
  'MemoryPressure|False': 'The node has sufficient memory',
  'DiskPressure|True': 'The node is running low on disk space',
  'DiskPressure|False': 'The node has sufficient disk space',
  'PIDPressure|True': 'The node is running out of process IDs',
  'PIDPressure|False': 'The node has sufficient process IDs',
  'NetworkUnavailable|True': 'The node network is not correctly configured',
  'NetworkUnavailable|False': 'The node network is configured correctly',
};

/**
 * Returns a plain-English explanation of a condition. Falls back to the raw
 * reason (or the type/status pair) when no mapping exists — never fabricates.
 */
export function getFriendlyConditionText(
  type: string,
  status: string,
  reason?: string
): string | undefined {
  if (reason && FRIENDLY_BY_REASON[reason]) return FRIENDLY_BY_REASON[reason];
  const typeStatusKey = `${type}|${status}`;
  if (FRIENDLY_BY_TYPE_STATUS[typeStatusKey]) return FRIENDLY_BY_TYPE_STATUS[typeStatusKey];
  return undefined;
}

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
 * Pure logic for the Cleanup page: which namespaces a recent Flux uninstall
 * left behind, and which kinds of leftover objects it is safe to sweep. Free
 * of Headlamp imports so it can be unit tested in isolation.
 */

import { FluxObject } from './utils';

/** The controllers whose deletion events mark a real Flux uninstall. */
export const FLUX_DELETE_CONTROLLERS = new Set([
  'kustomize-controller',
  'helm-controller',
  'source-controller',
]);

/** Event reasons that mean Flux removed (or is removing) objects. */
const DELETE_REASON = /uninstall|garbage.?collect|prune|delet|remov|finaliz/i;

/** Namespaces that are Flux's own control plane and must never be suggested. */
const CONTROL_NAMESPACES = new Set(['flux-system', 'kube-system', 'kube-public', 'kube-node-lease']);

/** One kind of leftover the cleanup modal can sweep from a namespace. */
export interface CleanupKind {
  kind: string;
  label: string;
  /** Whether it is ticked by default (safe, common leftovers) or not (riskier). */
  defaultSelected: boolean;
  /** Why it is (not) on by default, shown as help text. */
  note?: string;
}

/**
 * The kinds offered in the cleanup modal. Workloads, config and the objects
 * that usually block a namespace from draining are on by default; anything
 * that can carry data or permissions a future install may reuse is off by
 * default so it is only removed on a deliberate choice.
 */
export const CLEANUP_KINDS: CleanupKind[] = [
  { kind: 'Pod', label: 'Pods', defaultSelected: true },
  { kind: 'Deployment', label: 'Deployments', defaultSelected: true },
  { kind: 'StatefulSet', label: 'StatefulSets', defaultSelected: true },
  { kind: 'DaemonSet', label: 'DaemonSets', defaultSelected: true },
  { kind: 'ReplicaSet', label: 'ReplicaSets', defaultSelected: true },
  { kind: 'Job', label: 'Jobs', defaultSelected: true },
  { kind: 'CronJob', label: 'CronJobs', defaultSelected: true },
  { kind: 'Service', label: 'Services', defaultSelected: true },
  { kind: 'ConfigMap', label: 'ConfigMaps', defaultSelected: true },
  { kind: 'Secret', label: 'Secrets', defaultSelected: true },
  { kind: 'Ingress', label: 'Ingresses', defaultSelected: true },
  {
    kind: 'HorizontalPodAutoscaler',
    label: 'HorizontalPodAutoscalers',
    defaultSelected: true,
  },
  {
    kind: 'PersistentVolumeClaim',
    label: 'PersistentVolumeClaims',
    defaultSelected: false,
    note: 'Deletes stored data. Off by default.',
  },
  {
    kind: 'ServiceAccount',
    label: 'ServiceAccounts',
    defaultSelected: false,
    note: 'May be reused by a future install.',
  },
  {
    kind: 'Role',
    label: 'Roles',
    defaultSelected: false,
    note: 'Permissions; off by default.',
  },
  {
    kind: 'RoleBinding',
    label: 'RoleBindings',
    defaultSelected: false,
    note: 'Permissions; off by default.',
  },
  {
    kind: 'NetworkPolicy',
    label: 'NetworkPolicies',
    defaultSelected: false,
  },
  {
    kind: 'PodDisruptionBudget',
    label: 'PodDisruptionBudgets',
    defaultSelected: false,
  },
];

/** A recent Flux uninstall that may have left objects behind in a namespace. */
export interface RecentUninstall {
  namespace: string;
  /** The Flux controller that reported the removal. */
  controller: string;
  reason: string;
  message: string;
  /** ISO time of the most recent related event. */
  time: string;
  /** How many delete/prune events referenced this namespace in the window. */
  eventCount: number;
}

/** The event fields we read; kept loose because it is raw Kubernetes JSON. */
interface RawEvent {
  reason?: string;
  message?: string;
  type?: string;
  lastTimestamp?: string;
  eventTime?: string;
  firstTimestamp?: string;
  metadata?: { namespace?: string; creationTimestamp?: string };
  involvedObject?: { kind?: string; namespace?: string; name?: string };
  source?: { component?: string };
  reportingComponent?: string;
}

function eventController(event: RawEvent): string {
  return event.source?.component || event.reportingComponent || '';
}

function eventTime(event: RawEvent): string {
  return (
    event.lastTimestamp ||
    event.eventTime ||
    event.firstTimestamp ||
    event.metadata?.creationTimestamp ||
    ''
  );
}

/**
 * Namespaces named in an event message: "ns/name" references and explicit
 * "namespace <ns>" phrasing, which is how Flux controllers report the objects
 * they prune or the release they uninstall.
 */
export function namespacesFromMessage(message: string): string[] {
  const out = new Set<string>();
  const token = '[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?';
  const nsSlash = new RegExp(`(${token})/[a-z0-9]`, 'gi');
  for (const m of message.matchAll(nsSlash)) {
    out.add(m[1].toLowerCase());
  }
  const nsWord = new RegExp(`namespace[\\s=:'"]+(${token})`, 'gi');
  for (const m of message.matchAll(nsWord)) {
    out.add(m[1].toLowerCase());
  }
  return Array.from(out);
}

/**
 * The namespaces a recent Flux uninstall touched, newest first, so the
 * Cleanup page can suggest exactly where leftovers might remain. Only Flux
 * controller deletion/prune events inside the time window count, and Flux's
 * own control namespaces are never suggested; this keeps the suggestions
 * accurate to genuine, recent uninstalls.
 */
export function findRecentUninstalls(
  events: FluxObject[],
  opts?: { now?: number; windowMs?: number }
): RecentUninstall[] {
  const now = opts?.now ?? Date.now();
  const windowMs = opts?.windowMs ?? 6 * 60 * 60 * 1000; // 6 hours
  const byNamespace = new Map<string, RecentUninstall>();

  for (const raw of events) {
    const event = raw as RawEvent;
    const controller = eventController(event);
    if (!FLUX_DELETE_CONTROLLERS.has(controller)) {
      continue;
    }
    const reason = event.reason ?? '';
    const message = event.message ?? '';
    if (!DELETE_REASON.test(reason) && !DELETE_REASON.test(message)) {
      continue;
    }
    const time = eventTime(event);
    const ms = time ? new Date(time).getTime() : NaN;
    if (Number.isNaN(ms) || now - ms > windowMs || ms - now > 60 * 1000) {
      continue;
    }

    // Prefer namespaces named in the message (the target/app namespace); the
    // involvedObject namespace is usually flux-system, which we do not clean.
    const candidates = namespacesFromMessage(message);
    if (candidates.length === 0 && event.involvedObject?.namespace) {
      candidates.push(event.involvedObject.namespace.toLowerCase());
    }

    for (const namespace of candidates) {
      if (CONTROL_NAMESPACES.has(namespace)) {
        continue;
      }
      const existing = byNamespace.get(namespace);
      if (!existing) {
        byNamespace.set(namespace, {
          namespace,
          controller,
          reason,
          message,
          time,
          eventCount: 1,
        });
      } else {
        existing.eventCount += 1;
        if (time > existing.time) {
          existing.time = time;
          existing.controller = controller;
          existing.reason = reason;
          existing.message = message;
        }
      }
    }
  }

  return Array.from(byNamespace.values()).sort((a, b) => b.time.localeCompare(a.time));
}

/** The live status of one object as the cleanup sweeps it. */
export type CleanupItemStatus = 'pending' | 'deleting' | 'deleted' | 'failed';

/** One object the cleanup will (or did) delete. */
export interface CleanupItem {
  kind: string;
  name: string;
  namespace: string;
  status: CleanupItemStatus;
  /** Deleted with grace period 0 (force). */
  force: boolean;
  /** Error text when the delete failed. */
  error?: string;
}

/** Per-kind tally of a finished cleanup. */
export interface CleanupKindResult {
  kind: string;
  deleted: number;
  failed: number;
}

/**
 * Rolls a list of cleanup items up into a per-kind summary (how many of each
 * kind were deleted, how many failed), for the completion view.
 */
export function summarizeCleanup(items: CleanupItem[]): {
  byKind: CleanupKindResult[];
  totalDeleted: number;
  totalFailed: number;
} {
  const byKind = new Map<string, CleanupKindResult>();
  let totalDeleted = 0;
  let totalFailed = 0;
  for (const item of items) {
    let entry = byKind.get(item.kind);
    if (!entry) {
      entry = { kind: item.kind, deleted: 0, failed: 0 };
      byKind.set(item.kind, entry);
    }
    if (item.status === 'deleted') {
      entry.deleted += 1;
      totalDeleted += 1;
    } else if (item.status === 'failed') {
      entry.failed += 1;
      totalFailed += 1;
    }
  }
  return {
    byKind: Array.from(byKind.values())
      .filter(k => k.deleted > 0 || k.failed > 0)
      .sort((a, b) => a.kind.localeCompare(b.kind)),
    totalDeleted,
    totalFailed,
  };
}

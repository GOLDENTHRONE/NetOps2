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

import { Icon } from '@iconify/react';
import { K8s, Router } from '@kinvolk/headlamp-plugin/lib';
import {
  DateLabel,
  HoverInfoLabel,
  Link as HeadlampLink,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { localeDate } from '@kinvolk/headlamp-plugin/lib/Utils';
import { Box, Link as MuiLink, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { ICONS } from '../flux/icon';
import { pluralizeKind } from '../flux/insights';
import { kindByName } from '../flux/kinds';
import {
  FluxHealth,
  FluxObject,
  getCommitInfo,
  getCommitWebUrl,
  getNextSyncTime,
  getSourceWebUrl,
  getStatusInfo,
  parseRevision,
} from '../flux/utils';
import { Pill, PillTone } from './ui';

const { createRouteURL } = Router;

/**
 * The one way to show "this field has no value": a quiet italic "n/a"
 * instead of a bare dash, so empty never looks broken.
 */
export function NA() {
  return (
    <Typography
      component="span"
      variant="inherit"
      sx={{ fontStyle: 'italic', color: 'text.secondary' }}
    >
      n/a
    </Typography>
  );
}

/** Opens a URL in a new tab, clickable link with an external-link affordance. */
export function ExternalLink(props: { url?: string; children?: React.ReactNode }) {
  const { url, children } = props;
  if (!url) {
    return <>{children ?? <NA />}</>;
  }
  return (
    <MuiLink
      href={url}
      target="_blank"
      rel="noreferrer"
      sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, wordBreak: 'break-all' }}
      onClick={e => e.stopPropagation()}
    >
      {children ?? url}
      <Icon icon={ICONS.externalLink} width="0.9rem" style={{ flexShrink: 0 }} />
    </MuiLink>
  );
}

/** A source's URL rendered as a clickable link to the actual repository/registry. */
export function SourceUrlLink(props: { url?: string }) {
  const { url } = props;
  if (!url) {
    return <NA />;
  }
  const webUrl = getSourceWebUrl(url);
  if (!webUrl) {
    // Not browsable (e.g. s3://). Show the raw URL as plain text.
    return <span style={{ wordBreak: 'break-all' }}>{url}</span>;
  }
  return <ExternalLink url={webUrl}>{url}</ExternalLink>;
}

/** Commit author + relative time of the last change Flux pulled, when known. */
export function CommitAuthorLabel(props: { object: FluxObject }) {
  const info = getCommitInfo(props.object);
  if (!info.author && !info.time) {
    return <NA />;
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      {info.author && (
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4 }}>
          <Icon icon={ICONS.author} width="0.95rem" />
          <Typography variant="body2" component="span" sx={{ whiteSpace: 'nowrap' }}>
            {info.author}
          </Typography>
        </Box>
      )}
      {info.message && (
        <Typography variant="caption" color="textSecondary" noWrap sx={{ maxWidth: 220 }}>
          {info.message}
        </Typography>
      )}
    </Box>
  );
}

export function healthToStatus(health: FluxHealth): 'success' | 'warning' | 'error' | '' {
  switch (health) {
    case 'Ready':
      return 'success';
    case 'NotReady':
      return 'error';
    case 'Reconciling':
      return 'warning';
    default:
      return '';
  }
}

/** Maps a Flux health to a design-system pill tone + icon + label. */
export function healthPresentation(health: FluxHealth): {
  tone: PillTone;
  icon: string;
  label: string;
} {
  switch (health) {
    case 'Ready':
      return { tone: 'success', icon: ICONS.statusReady, label: 'Ready' };
    case 'NotReady':
      return { tone: 'error', icon: ICONS.statusError, label: 'Failed' };
    case 'Reconciling':
      return { tone: 'warning', icon: ICONS.statusReconciling, label: 'Reconciling' };
    case 'Suspended':
      return { tone: 'neutral', icon: ICONS.statusSuspended, label: 'Suspended' };
    default:
      return { tone: 'neutral', icon: ICONS.statusUnknown, label: 'Unknown' };
  }
}

/**
 * Status pill for a Flux resource. Hovering shows the full condition message,
 * which for failed resources is the failure message.
 */
export function FluxStatusLabel(props: { object: FluxObject }) {
  const info = getStatusInfo(props.object);
  const p = healthPresentation(info.health);
  return (
    <Pill
      tone={p.tone}
      icon={p.icon}
      title={[info.reason, info.message].filter(Boolean).join(': ')}
    >
      {p.label}
    </Pill>
  );
}

/** The artifact revision (branch/tag + short commit) linking out to the commit when possible. */
export function RevisionLabel(props: { object: FluxObject }) {
  const { object } = props;
  const revision =
    object?.status?.artifact?.revision ||
    object?.status?.lastAppliedRevision ||
    object?.status?.lastAttemptedRevision;
  if (!revision) {
    return <NA />;
  }
  const parsed = parseRevision(revision);
  const commitUrl =
    object?.kind === 'GitRepository' ? getCommitWebUrl(object?.spec?.url, parsed.hash) : undefined;

  const text = [parsed.ref, parsed.shortHash].filter(Boolean).join(' @ ') || revision;

  return (
    <Tooltip title={revision}>
      {commitUrl ? (
        <MuiLink href={commitUrl} target="_blank" rel="noreferrer">
          {text}
        </MuiLink>
      ) : (
        <span>{text}</span>
      )}
    </Tooltip>
  );
}

/** Relative time of the last successful sync. */
export function LastSyncLabel(props: { date?: string }) {
  if (!props.date) {
    return <NA />;
  }
  return <DateLabel date={props.date} format="mini" />;
}

/** The approximate time of the next scheduled reconciliation. */
export function NextSyncLabel(props: { object: FluxObject }) {
  const next = getNextSyncTime(props.object);
  if (!next) {
    return <NA />;
  }
  const seconds = Math.max(0, Math.round((next.getTime() - Date.now()) / 1000));
  const inText =
    seconds < 60
      ? `in ${seconds}s`
      : seconds < 3600
      ? `in ${Math.round(seconds / 60)}m`
      : `in ${Math.round(seconds / 360) / 10}h`;
  return <HoverInfoLabel label={inText} hoverInfo={localeDate(next)} icon={ICONS.timer} />;
}

/** Link to the details page of a Flux resource (route name == kind). */
export function FluxLink(props: {
  kind: string;
  name: string;
  namespace?: string;
  children?: React.ReactNode;
}) {
  const { kind, name, namespace, children } = props;
  let url: string | undefined;
  try {
    url = createRouteURL(kind, { namespace: namespace ?? '', name });
  } catch (e) {
    url = undefined;
  }
  if (!url) {
    return <>{children ?? name}</>;
  }
  return (
    <MuiLink component={RouterLink} to={url}>
      {children ?? name}
    </MuiLink>
  );
}

/**
 * The one way to link to any Kubernetes object from the Flux UI:
 * - Flux kinds go to their rich Flux details pages;
 * - built-in kinds open in Headlamp's split-right details panel (when the
 *   drawer is enabled) instead of navigating away;
 * - custom resources (Vault secrets, cert-manager, ...) open the same way
 *   through Headlamp's generic custom-resource view.
 */
export function K8sRefLink(props: {
  kind: string;
  /** API group when known; leave undefined to match by kind name only. */
  group?: string;
  name: string;
  namespace?: string;
  children?: React.ReactNode;
}) {
  const { kind, group, name, namespace, children } = props;

  const fluxKind = kindByName(kind, group || undefined);
  if (fluxKind && (group === undefined || group === fluxKind.group)) {
    return (
      <FluxLink kind={kind} name={name} namespace={namespace}>
        {children ?? name}
      </FluxLink>
    );
  }

  const cls = (K8s.ResourceClasses as Record<string, any>)[kind];
  if (cls && (group === undefined || (cls.apiGroupName ?? '') === group)) {
    let obj: any = null;
    try {
      obj = new cls({
        kind,
        apiVersion: cls.apiGroupName ? `${cls.apiGroupName}/v1` : 'v1',
        metadata: { name, namespace },
      });
    } catch (e) {
      obj = null;
    }
    if (obj) {
      return <HeadlampLink kubeObject={obj}>{children ?? name}</HeadlampLink>;
    }
  }

  if (group) {
    return (
      <HeadlampLink
        routeName="customresource"
        params={{
          crd: `${pluralizeKind(kind)}.${group}`,
          namespace: namespace ?? '-',
          crName: name,
        }}
      >
        {children ?? name}
      </HeadlampLink>
    );
  }

  return <>{children ?? name}</>;
}

/** Small "n Ready / n Failed / n Suspended" summary used on overview cards. */
export function ReadySummary(props: { objects: FluxObject[] }) {
  const counts = { Ready: 0, NotReady: 0, Reconciling: 0, Suspended: 0, Unknown: 0 };
  for (const o of props.objects) {
    counts[getStatusInfo(o).health]++;
  }
  return (
    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
      <Pill tone="success" icon={ICONS.statusReady}>
        {counts.Ready} ready
      </Pill>
      {counts.NotReady > 0 && (
        <Pill tone="error" icon={ICONS.statusError}>
          {counts.NotReady} failed
        </Pill>
      )}
      {counts.Reconciling > 0 && (
        <Pill tone="warning" icon={ICONS.statusReconciling}>
          {counts.Reconciling} reconciling
        </Pill>
      )}
      {counts.Suspended > 0 && (
        <Pill tone="neutral" icon={ICONS.statusSuspended}>
          {counts.Suspended} suspended
        </Pill>
      )}
    </Box>
  );
}

export function SectionEmpty(props: { message: string }) {
  return (
    <Typography variant="body2" color="textSecondary" sx={{ py: 2, textAlign: 'center' }}>
      {props.message}
    </Typography>
  );
}

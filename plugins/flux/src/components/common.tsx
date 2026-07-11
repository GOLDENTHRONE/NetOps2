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
import { Router } from '@kinvolk/headlamp-plugin/lib';
import {
  DateLabel,
  HoverInfoLabel,
  StatusLabel,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { localeDate } from '@kinvolk/headlamp-plugin/lib/Utils';
import { Box, Link as MuiLink, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
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

const { createRouteURL } = Router;

/** Opens a URL in a new tab, clickable link with an external-link affordance. */
export function ExternalLink(props: { url?: string; children?: React.ReactNode }) {
  const { url, children } = props;
  if (!url) {
    return <>{children ?? '-'}</>;
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
      <Icon icon="mdi:open-in-new" width="0.9rem" style={{ flexShrink: 0 }} />
    </MuiLink>
  );
}

/** A source's URL rendered as a clickable link to the actual repository/registry. */
export function SourceUrlLink(props: { url?: string }) {
  const { url } = props;
  if (!url) {
    return <>-</>;
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
    return <>-</>;
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      {info.author && (
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4 }}>
          <Icon icon="mdi:account" width="0.95rem" />
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

/**
 * Status chip for a Flux resource. Hovering shows the full condition message,
 * which for failed resources is the failure message.
 */
export function FluxStatusLabel(props: { object: FluxObject }) {
  const info = getStatusInfo(props.object);
  const label =
    info.health === 'Suspended' ? (
      <>
        <Icon icon="mdi:pause" width="1rem" style={{ verticalAlign: 'text-top' }} /> Suspended
      </>
    ) : (
      info.health
    );
  return (
    <StatusLabel
      status={healthToStatus(info.health)}
      title={[info.reason, info.message].filter(Boolean).join(': ')}
    >
      {label}
    </StatusLabel>
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
    return <>-</>;
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
    return <>-</>;
  }
  return <DateLabel date={props.date} format="mini" />;
}

/** The approximate time of the next scheduled reconciliation. */
export function NextSyncLabel(props: { object: FluxObject }) {
  const next = getNextSyncTime(props.object);
  if (!next) {
    return <>-</>;
  }
  const seconds = Math.max(0, Math.round((next.getTime() - Date.now()) / 1000));
  const inText =
    seconds < 60
      ? `in ${seconds}s`
      : seconds < 3600
      ? `in ${Math.round(seconds / 60)}m`
      : `in ${Math.round(seconds / 360) / 10}h`;
  return <HoverInfoLabel label={inText} hoverInfo={localeDate(next)} icon="mdi:timer-outline" />;
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

/** Small "n Ready / n Failed / n Suspended" summary used on overview cards. */
export function ReadySummary(props: { objects: FluxObject[] }) {
  const counts = { Ready: 0, NotReady: 0, Reconciling: 0, Suspended: 0, Unknown: 0 };
  for (const o of props.objects) {
    counts[getStatusInfo(o).health]++;
  }
  return (
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
      <StatusLabel status="success">{counts.Ready} ready</StatusLabel>
      {counts.NotReady > 0 && <StatusLabel status="error">{counts.NotReady} failed</StatusLabel>}
      {counts.Reconciling > 0 && (
        <StatusLabel status="warning">{counts.Reconciling} reconciling</StatusLabel>
      )}
      {counts.Suspended > 0 && <StatusLabel status="">{counts.Suspended} suspended</StatusLabel>}
      {counts.Unknown > 0 && <StatusLabel status="">{counts.Unknown} unknown</StatusLabel>}
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

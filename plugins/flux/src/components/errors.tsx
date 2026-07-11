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
import { alpha, Box, Paper, Typography, useTheme } from '@mui/material';
import React from 'react';
import { ICONS } from '../flux/icon';

/**
 * Turns raw API errors into something a person can act on, instead of a
 * stuck spinner or a misleading default message.
 */
export interface FriendlyError {
  /** Short, plain-language summary. */
  title: string;
  /** One or two sentences explaining what it means / what to do. */
  detail: string;
  /** Iconify icon (only icons cached for offline use). */
  icon: string;
  /** 'warning' for expected situations (not installed), 'error' for real failures. */
  severity: 'warning' | 'error';
  /** The raw technical message, for the expandable details. */
  raw?: string;
}

function statusOf(error: any): number | undefined {
  if (!error) {
    return undefined;
  }
  const status = error.status ?? error.statusCode ?? error?.response?.status;
  if (typeof status === 'number') {
    return status;
  }
  // Some errors only carry the code in their message, e.g. "Error: 403".
  const match = /\b(401|403|404|500|502|503|504)\b/.exec(String(error.message ?? error));
  return match ? parseInt(match[1], 10) : undefined;
}

function isNetworkError(error: any): boolean {
  const text = String(error?.message ?? error ?? '').toLowerCase();
  return (
    text.includes('unreachable') ||
    text.includes('failed to fetch') ||
    text.includes('networkerror') ||
    text.includes('network error') ||
    text.includes('timeout') ||
    text.includes('offline')
  );
}

/**
 * Picks the most meaningful error from a set: permission/auth/network
 * problems beat plain "not found" (missing CRDs), which is often expected.
 */
export function pickMostRelevantError(errors: any[]): any {
  const present = errors.filter(Boolean);
  return present.find(e => statusOf(e) !== 404) ?? present[0];
}

/**
 * Describes an error from listing/getting Flux resources.
 *
 * @param error The raw error (ApiError or anything thrown).
 * @param what What we were trying to load, e.g. "Git repositories".
 * @param options.fluxKind Set when "not found" means the Flux CRD is missing.
 */
export function describeError(
  error: any,
  what: string,
  options: { fluxKind?: string; group?: string } = {}
): FriendlyError {
  const status = statusOf(error);
  const raw = String(error?.message ?? error ?? 'Unknown error');

  if (status === 404 && options.fluxKind) {
    return {
      title: `${options.fluxKind} is not available in this cluster`,
      detail:
        `The ${options.fluxKind} API${options.group ? ` (${options.group})` : ''} was not found. ` +
        'This usually means Flux (or this Flux component) is not installed in the cluster.',
      icon: ICONS.notInstalled,
      severity: 'warning',
      raw,
    };
  }
  if (status === 404) {
    return {
      title: `Could not find ${what}`,
      detail: 'The cluster does not have this resource. It may not be installed.',
      icon: ICONS.notInstalled,
      severity: 'warning',
      raw,
    };
  }
  if (status === 401) {
    return {
      title: 'Your session is not authenticated',
      detail: `The cluster rejected the request for ${what}. Try signing in to the cluster again.`,
      icon: ICONS.lock,
      severity: 'error',
      raw,
    };
  }
  if (status === 403) {
    return {
      title: `You don't have permission to view ${what}`,
      detail:
        'Your Kubernetes user or service account lacks RBAC permission for this resource. ' +
        'Ask a cluster administrator for read access to the Flux resources.',
      icon: ICONS.lock,
      severity: 'error',
      raw,
    };
  }
  if (isNetworkError(error)) {
    return {
      title: `Could not reach the cluster while loading ${what}`,
      detail:
        'The cluster (or the Headlamp backend) did not respond. Check your connection and that ' +
        'the cluster is reachable, then try again.',
      icon: ICONS.unreachable,
      severity: 'error',
      raw,
    };
  }
  return {
    title: `Something went wrong while loading ${what}`,
    detail: 'The cluster returned an unexpected error. The technical details are below.',
    icon: ICONS.statusError,
    severity: 'error',
    raw,
  };
}

/**
 * A modern, readable error block: icon, plain-language title and explanation,
 * plus the raw technical message for debugging. Use instead of leaving a
 * spinner running or showing a misleading default.
 */
export function ErrorState(props: { error: any; what: string; fluxKind?: string; group?: string }) {
  const { error, what, fluxKind, group } = props;
  const theme = useTheme();
  const friendly = describeError(error, what, { fluxKind, group });
  const color =
    friendly.severity === 'warning' ? theme.palette.warning.main : theme.palette.error.main;

  return (
    <Paper
      variant="outlined"
      sx={{
        display: 'flex',
        gap: 2,
        alignItems: 'flex-start',
        p: 2.5,
        my: 1,
        borderLeft: `4px solid ${color}`,
        backgroundColor: alpha(color, 0.05),
      }}
      role="alert"
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '50%',
          backgroundColor: alpha(color, 0.15),
          minWidth: 42,
          height: 42,
        }}
      >
        <Icon icon={friendly.icon} width="1.4rem" color={color} />
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.3 }}>
          {friendly.title}
        </Typography>
        <Typography variant="body2" color="textSecondary" sx={{ mt: 0.5 }}>
          {friendly.detail}
        </Typography>
        {friendly.raw && (
          <Box component="details" sx={{ mt: 1 }}>
            <Typography
              component="summary"
              variant="caption"
              color="textSecondary"
              sx={{ cursor: 'pointer' }}
            >
              Technical details
            </Typography>
            <Typography
              component="code"
              variant="caption"
              sx={{
                display: 'block',
                mt: 0.5,
                p: 1,
                borderRadius: 1,
                backgroundColor: theme.palette.action.hover,
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {friendly.raw}
            </Typography>
          </Box>
        )}
      </Box>
    </Paper>
  );
}

/** Compact one-line error for cards and dense layouts, with the details on hover. */
export function InlineError(props: { error: any; what: string; fluxKind?: string }) {
  const { error, what, fluxKind } = props;
  const theme = useTheme();
  const friendly = describeError(error, what, { fluxKind });
  const color =
    friendly.severity === 'warning' ? theme.palette.warning.main : theme.palette.error.main;
  return (
    <Box
      sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}
      title={`${friendly.detail}${friendly.raw ? `\n\n${friendly.raw}` : ''}`}
    >
      <Icon icon={friendly.icon} color={color} width="1.1rem" />
      <Typography variant="body2" sx={{ color }}>
        {friendly.title}
      </Typography>
    </Box>
  );
}

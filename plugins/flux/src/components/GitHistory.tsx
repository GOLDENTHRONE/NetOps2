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
 * A VS-Code-style commit graph for GitRepository sources: the recent commits
 * of the tracked branch straight from the Git host, with the commit that is
 * currently deployed by Flux highlighted; so "what changed and where are
 * we" is answered visually, without leaving the page.
 */

import { Icon } from '@iconify/react';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { DateLabel, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { alpha, Box, Link as MuiLink, Typography, useTheme } from '@mui/material';
import React from 'react';
import { ICONS } from '../flux/icon';
import { FluxObject, getSourceWebUrl, parseRevision } from '../flux/utils';
import { SectionEmpty } from './common';
import { Pill, Surface, useAccents } from './ui';

interface CommitEntry {
  sha: string;
  message: string;
  author?: string;
  date?: string;
  url?: string;
}

type FetchState =
  | { phase: 'loading' }
  | { phase: 'unsupported' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; commits: CommitEntry[] };

/**
 * The credentials Flux itself uses for this repository, read from the
 * Secret referenced by spec.secretRef (visible only to users whose RBAC
 * allows reading it). HTTPS tokens can authenticate the Git host API from
 * the browser; SSH keys cannot.
 */
type GitAuth =
  | { phase: 'loading' }
  | { phase: 'none' }
  | { phase: 'ssh' }
  | { phase: 'token'; token: string };

function useGitAuth(object: FluxObject): GitAuth {
  const secretName = object?.spec?.secretRef?.name;
  const namespace = object?.metadata?.namespace;
  // The hook must run unconditionally; without a secretRef we ask for a
  // name that cannot exist and ignore the result.
  const [secret, error] = (K8s.ResourceClasses as any).Secret.useGet(
    secretName ?? 'flux-no-credentials-secret',
    namespace
  );
  if (!secretName || error) {
    return { phase: 'none' };
  }
  if (secret === null) {
    return { phase: 'loading' };
  }
  const data = secret.jsonData?.data ?? {};
  const decode = (value?: string) => {
    try {
      return value ? atob(value).trim() : undefined;
    } catch (e) {
      return undefined;
    }
  };
  const token = decode(data.password) ?? decode(data.bearerToken) ?? decode(data.token);
  if (token) {
    return { phase: 'token', token };
  }
  if (data.identity) {
    return { phase: 'ssh' };
  }
  return { phase: 'none' };
}

/** Builds the commit-list API request for the known Git hosts. */
export function commitApiUrl(repoUrl?: string, branch?: string): string | undefined {
  const webUrl = getSourceWebUrl(repoUrl);
  if (!webUrl) {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(webUrl);
  } catch (e) {
    return undefined;
  }
  const path = parsed.pathname.replace(/^\/+|\/+$/g, '');
  if (parsed.host === 'github.com') {
    const query = branch ? `?sha=${encodeURIComponent(branch)}&per_page=15` : '?per_page=15';
    return `https://api.github.com/repos/${path}/commits${query}`;
  }
  if (parsed.host.includes('gitlab')) {
    const query = branch ? `?ref_name=${encodeURIComponent(branch)}&per_page=15` : '?per_page=15';
    return `https://${parsed.host}/api/v4/projects/${encodeURIComponent(
      path
    )}/repository/commits${query}`;
  }
  return undefined;
}

function normalizeCommits(host: 'github' | 'gitlab', data: any[]): CommitEntry[] {
  if (host === 'github') {
    return data.map((c: any) => ({
      sha: c.sha,
      message: (c.commit?.message ?? '').split('\n')[0],
      author: c.commit?.author?.name,
      date: c.commit?.author?.date,
      url: c.html_url,
    }));
  }
  return data.map((c: any) => ({
    sha: c.id,
    message: c.title ?? (c.message ?? '').split('\n')[0],
    author: c.author_name,
    date: c.created_at,
    url: c.web_url,
  }));
}

function useCommitHistory(repoUrl?: string, branch?: string, auth?: GitAuth): FetchState {
  const [state, setState] = React.useState<FetchState>({ phase: 'loading' });
  const apiUrl = commitApiUrl(repoUrl, branch);
  const authPhase = auth?.phase ?? 'none';
  const token = auth?.phase === 'token' ? auth.token : undefined;

  React.useEffect(() => {
    if (!apiUrl) {
      setState({ phase: 'unsupported' });
      return;
    }
    if (authPhase === 'loading') {
      // Wait for the credentials secret so private repos work on the first try.
      setState({ phase: 'loading' });
      return;
    }
    const isGitHub = apiUrl.startsWith('https://api.github.com');
    // Use the same credentials Flux uses, sent only to the repository's own
    // Git host (GitHub's API host for github.com repositories).
    const headers: Record<string, string> = token
      ? isGitHub
        ? { Authorization: `Bearer ${token}` }
        : { 'PRIVATE-TOKEN': token }
      : {};
    const controller = new AbortController();
    setState({ phase: 'loading' });
    fetch(apiUrl, { signal: controller.signal, headers })
      .then(async response => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        setState({
          phase: 'ready',
          commits: normalizeCommits(isGitHub ? 'github' : 'gitlab', data),
        });
      })
      .catch(error => {
        if (controller.signal.aborted) {
          return;
        }
        const detail = String(error?.message ?? error);
        let message: string;
        if (authPhase === 'ssh') {
          message =
            'This repository is accessed with SSH credentials, which the dashboard cannot use ' +
            `to query the Git host API from the browser (${detail}). Add an HTTPS token secret ` +
            'to see the commit history here.';
        } else if (token) {
          message =
            `The Git host rejected the request even with the Flux credentials secret (${detail}). ` +
            'The token may lack read access to this repository or to the commits API.';
        } else {
          message =
            `The Git host rejected the request (${detail}). The repository may be private ` +
            '(no usable HTTPS token was found in the Flux credentials secret) or the API rate ' +
            'limit was reached.';
        }
        setState({ phase: 'error', message });
      });
    return () => controller.abort();
  }, [apiUrl, authPhase, token]);

  return state;
}

const RAIL_WIDTH = 28;
const DOT_SIZE = 11;

function CommitRow(props: {
  commit: CommitEntry;
  deployed: boolean;
  aheadOfDeployment: boolean;
  isFirst: boolean;
  isLast: boolean;
}) {
  const { commit, deployed, aheadOfDeployment, isFirst, isLast } = props;
  const theme = useTheme();
  const accents = useAccents();
  const dotColor = deployed
    ? accents.success
    : aheadOfDeployment
    ? accents.warning
    : theme.palette.text.disabled;

  return (
    <Box sx={{ display: 'flex', minHeight: 52 }}>
      {/* The graph rail: a continuous line with one dot per commit. */}
      <Box
        sx={{
          width: RAIL_WIDTH,
          flexShrink: 0,
          position: 'relative',
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <Box
          sx={{
            position: 'absolute',
            top: isFirst ? 20 : 0,
            bottom: isLast ? 'auto' : 0,
            height: isLast ? 20 : undefined,
            width: '2px',
            backgroundColor: alpha(theme.palette.text.disabled, 0.3),
          }}
        />
        <Box
          sx={{
            position: 'relative',
            mt: '15px',
            width: DOT_SIZE,
            height: DOT_SIZE,
            borderRadius: '50%',
            backgroundColor: deployed ? dotColor : theme.palette.background.paper,
            border: `2.5px solid ${dotColor}`,
            zIndex: 1,
            flexShrink: 0,
          }}
        />
      </Box>
      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          py: 1,
          pl: 0.5,
          borderRadius: '8px',
          ...(deployed ? { backgroundColor: alpha(accents.success, 0.07), px: 1 } : {}),
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          {commit.url ? (
            <MuiLink
              href={commit.url}
              target="_blank"
              rel="noreferrer"
              sx={{ fontFamily: 'monospace', fontSize: '0.8rem', fontWeight: 700 }}
            >
              {commit.sha.slice(0, 8)}
            </MuiLink>
          ) : (
            <Typography component="span" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
              {commit.sha.slice(0, 8)}
            </Typography>
          )}
          <Typography variant="body2" noWrap sx={{ fontWeight: deployed ? 700 : 500, minWidth: 0 }}>
            {commit.message}
          </Typography>
          {deployed && (
            <Pill tone="success" icon={ICONS.statusReady}>
              deployed now
            </Pill>
          )}
          {aheadOfDeployment && (
            <Pill tone="warning" icon={ICONS.clock}>
              not deployed yet
            </Pill>
          )}
        </Box>
        <Typography
          variant="caption"
          color="text.secondary"
          component="div"
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            mt: 0.25,
            // DateLabel renders its own Typography; keep every piece of this
            // line at the same size.
            '& .MuiTypography-root': { fontSize: 'inherit', lineHeight: 'inherit' },
          }}
        >
          <Icon icon={ICONS.author} width="0.85rem" style={{ flexShrink: 0 }} />
          <span>{commit.author ?? 'unknown'}</span>
          {commit.date && (
            <>
              <Box component="span" sx={{ opacity: 0.5 }}>
                |
              </Box>
              <DateLabel date={commit.date} format="mini" />
            </>
          )}
        </Typography>
      </Box>
    </Box>
  );
}

/**
 * The recent commit history of the tracked branch, with the currently
 * deployed commit highlighted. Commits above it exist in Git but have not
 * been picked up (or not fully deployed) yet.
 */
export function GitCommitHistorySection(props: { item: any }) {
  const object: FluxObject = props.item.jsonData;
  const repoUrl = object?.spec?.url;
  const branch = object?.spec?.ref?.branch ?? object?.spec?.ref?.name;
  const deployedHash = parseRevision(object?.status?.artifact?.revision).hash;

  const auth = useGitAuth(object);
  const state = useCommitHistory(repoUrl, branch, auth);

  if (state.phase === 'unsupported') {
    // Not a host we can query from the browser; stay quiet.
    return null;
  }

  const deployedIndex =
    state.phase === 'ready' && deployedHash
      ? state.commits.findIndex(
          c => c.sha.startsWith(deployedHash) || deployedHash.startsWith(c.sha)
        )
      : -1;

  return (
    <SectionBox title={`Commit history${branch ? ` (${branch})` : ''}`}>
      <Surface sx={{ px: 2, py: 1 }}>
        {state.phase === 'loading' ? (
          <SectionEmpty message="Loading commit history from the Git host…" />
        ) : state.phase === 'error' ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1.5 }}>
            <Icon icon={ICONS.info} width="1.1rem" style={{ opacity: 0.6, flexShrink: 0 }} />
            <Typography variant="body2" color="text.secondary">
              {state.message}
            </Typography>
          </Box>
        ) : state.commits.length === 0 ? (
          <SectionEmpty message="The Git host returned no commits for this branch" />
        ) : (
          <Box sx={{ py: 0.5 }}>
            {state.commits.map((commit, i) => (
              <CommitRow
                key={commit.sha}
                commit={commit}
                deployed={i === deployedIndex}
                aheadOfDeployment={deployedIndex !== -1 && i < deployedIndex}
                isFirst={i === 0}
                isLast={i === state.commits.length - 1}
              />
            ))}
          </Box>
        )}
      </Surface>
    </SectionBox>
  );
}

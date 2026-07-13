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
 * The "what is Flux deploying, and is it healthy?" view: every application
 * (a root Kustomization or HelmRelease plus everything it defines) as one
 * card with an overall health verdict, reconciliation state, member summary
 * and live pod health, including the problems an operator would otherwise
 * dig for by hand (CrashLoopBackOff, image pull failures, stuck pods).
 */

import { Icon } from '@iconify/react';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { Loader } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  alpha,
  Box,
  IconButton,
  InputAdornment,
  Link as MuiLink,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import React from 'react';
import { useHistory } from 'react-router-dom';
import { ICONS, kindIcon } from '../flux/icon';
import {
  Application,
  AppHealth,
  buildApplications,
  PodsSummary,
  summarizeApplication,
  summarizeAppPods,
} from '../flux/insights';
import { kindByName } from '../flux/kinds';
import { FluxObject } from '../flux/utils';
import { AllFluxObjects } from './operations';
import { Accents, Pill, PillTone, Section, Surface, useAccents } from './ui';

const { ResourceClasses } = K8s;

const FAVORITES_KEY = 'headlamp-flux-favorite-applications';

function loadFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch (e) {
    return new Set();
  }
}

function saveFavorites(favorites: Set<string>) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(favorites)));
  } catch (e) {
    // Ignore storage failures (private mode etc.).
  }
}

const HEALTH_PRESENTATION: Record<
  AppHealth,
  { tone: PillTone; icon: string; accent: (a: Accents) => string }
> = {
  Healthy: { tone: 'success', icon: ICONS.statusReady, accent: a => a.success },
  Degraded: { tone: 'warning', icon: ICONS.warning, accent: a => a.warning },
  Failing: { tone: 'error', icon: ICONS.statusError, accent: a => a.error },
  Deploying: { tone: 'info', icon: ICONS.statusReconciling, accent: a => a.info },
  Suspended: { tone: 'neutral', icon: ICONS.statusSuspended, accent: a => a.neutral },
};

function AppCard(props: {
  app: Application;
  pods: FluxObject[] | null;
  favorite: boolean;
  onToggleFavorite: (id: string) => void;
}) {
  const { app, pods, favorite, onToggleFavorite } = props;
  const theme = useTheme();
  const accents = useAccents();
  const history = useHistory();

  const podsSummary: PodsSummary | undefined = React.useMemo(
    () => (pods ? summarizeAppPods(app, pods) : undefined),
    [app, pods]
  );
  const verdict = summarizeApplication(app, podsSummary);
  const p = HEALTH_PRESENTATION[verdict.health];
  const accent = p.accent(accents);

  const kustomizations = app.members.filter(m => m.kind === 'Kustomization').length;
  const helmReleases = app.members.filter(m => m.kind === 'HelmRelease').length;

  // Aggregate pod issues by reason: "CrashLoopBackOff ×2".
  const issueCounts = new Map<string, number>();
  for (const issue of podsSummary?.issues ?? []) {
    issueCounts.set(issue.reason, (issueCounts.get(issue.reason) ?? 0) + 1);
  }

  const openApp = () => {
    const plural = kindByName(app.rootKind)?.plural ?? 'kustomizations';
    history.push(`/flux/${plural}/${app.namespace}/${app.name}`);
  };

  return (
    <Surface
      interactive
      accent={accent}
      onClick={openApp}
      sx={{ p: 2, minWidth: 260, flex: '1 1 280px', maxWidth: 420 }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
            <Icon icon={kindIcon(app.rootKind)} width="1.1rem" style={{ flexShrink: 0 }} />
            <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2 }} noWrap>
              {app.name}
            </Typography>
          </Box>
          <Typography variant="caption" color="text.secondary" noWrap component="div">
            {app.rootKind} · {app.namespace}
          </Typography>
        </Box>
        <Tooltip title={favorite ? 'Remove from favorites' : 'Add to favorites'}>
          <IconButton
            size="small"
            aria-label={favorite ? `Unfavorite ${app.name}` : `Favorite ${app.name}`}
            onClick={e => {
              e.stopPropagation();
              onToggleFavorite(app.id);
            }}
            sx={{ color: favorite ? accents.warning : theme.palette.text.disabled, mt: '-4px' }}
          >
            <Icon icon={favorite ? ICONS.starFilled : ICONS.star} width="1.1rem" />
          </IconButton>
        </Tooltip>
      </Box>

      <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 1 }}>
        <Pill tone={p.tone} icon={p.icon}>
          {verdict.health}
        </Pill>
        {verdict.reconciling ? (
          <Pill tone="info" icon={ICONS.statusReconciling}>
            reconciling
          </Pill>
        ) : (
          verdict.failingMembers === 0 && (
            <Pill tone="neutral" icon={ICONS.sync}>
              in sync
            </Pill>
          )
        )}
      </Box>

      <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
        {[
          kustomizations > 0
            ? `${kustomizations} kustomization${kustomizations === 1 ? '' : 's'}`
            : null,
          helmReleases > 0 ? `${helmReleases} helm release${helmReleases === 1 ? '' : 's'}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        {verdict.failingMembers > 0 && (
          <Box component="span" sx={{ color: accents.error, fontWeight: 600 }}>
            {' '}
            ({verdict.failingMembers} failing)
          </Box>
        )}
      </Typography>

      {podsSummary && podsSummary.total > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', mt: 0.5 }}>
          <Typography
            variant="caption"
            sx={{
              fontWeight: 600,
              color: podsSummary.ready === podsSummary.total ? accents.success : accents.warning,
            }}
          >
            {podsSummary.ready}/{podsSummary.total} pods ready
          </Typography>
          {Array.from(issueCounts.entries()).map(([reason, count]) => (
            <Pill key={reason} tone="error" icon={ICONS.statusError}>
              {reason}
              {count > 1 ? ` ×${count}` : ''}
            </Pill>
          ))}
        </Box>
      )}

      {app.targetNamespaces.length > 0 && (
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 1 }}>
          {app.targetNamespaces.slice(0, 3).map(namespace => (
            <Box
              key={namespace}
              component="span"
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.4,
                px: 0.75,
                py: '1px',
                borderRadius: '999px',
                fontSize: '0.7rem',
                fontWeight: 600,
                color: accents.primary,
                backgroundColor: alpha(accents.primary, 0.1),
              }}
            >
              <Icon icon={ICONS.namespace} width="0.75rem" />
              {namespace}
            </Box>
          ))}
          {app.targetNamespaces.length > 3 && (
            <Typography variant="caption" color="text.secondary">
              +{app.targetNamespaces.length - 3} more
            </Typography>
          )}
        </Box>
      )}
    </Surface>
  );
}

const INITIAL_VISIBLE = 8;

/**
 * The applications Flux manages in this cluster, each judged as a whole:
 * favorites first, filterable by name or namespace, expandable beyond the
 * first few.
 */
export function ApplicationsSection(props: { data: AllFluxObjects }) {
  const { rows, loading } = props.data;
  const [query, setQuery] = React.useState('');
  const [showAll, setShowAll] = React.useState(false);
  const [favorites, setFavorites] = React.useState<Set<string>>(loadFavorites);

  // One cluster-wide pod list powers the live health of every card.
  const [pods] = (ResourceClasses as Record<string, any>).Pod.useList();
  const podJsons: FluxObject[] | null = React.useMemo(
    () => (pods ? pods.map((p: any) => p.jsonData) : null),
    [pods]
  );

  const apps = React.useMemo(
    () => buildApplications(rows.map(r => ({ kind: r.kindDef.kind, object: r.object }))),
    [rows]
  );

  const onToggleFavorite = (id: string) => {
    setFavorites(current => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      saveFavorites(next);
      return next;
    });
  };

  const filtered = React.useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matching =
      terms.length === 0
        ? apps
        : apps.filter(app => {
            const haystack = [app.name, app.namespace, app.rootKind, ...app.targetNamespaces]
              .join(' ')
              .toLowerCase();
            return terms.every(term => haystack.includes(term));
          });
    // Favorites first, then alphabetical (buildApplications already sorts).
    return [...matching].sort((a, b) => Number(favorites.has(b.id)) - Number(favorites.has(a.id)));
  }, [apps, query, favorites]);

  if (loading) {
    return null;
  }
  if (apps.length === 0) {
    return null;
  }

  const visible = showAll ? filtered : filtered.slice(0, INITIAL_VISIBLE);

  return (
    <Section
      title={`Deployments (${apps.length})`}
      icon={ICONS.application}
      actions={
        apps.length > 4 ? (
          <TextField
            size="small"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Filter deployments"
            sx={{ width: 220 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Icon icon={ICONS.search} width="0.95rem" />
                </InputAdornment>
              ),
            }}
          />
        ) : undefined
      }
    >
      {pods === null && (
        <Box sx={{ mb: 1 }}>
          <Loader title="Checking pod health" size={18} />
        </Box>
      )}
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        {visible.map(app => (
          <AppCard
            key={app.id}
            app={app}
            pods={podJsons}
            favorite={favorites.has(app.id)}
            onToggleFavorite={onToggleFavorite}
          />
        ))}
      </Box>
      {filtered.length > INITIAL_VISIBLE && (
        <Typography variant="body2" sx={{ mt: 1.5 }}>
          <MuiLink component="button" type="button" onClick={() => setShowAll(s => !s)}>
            {showAll ? 'Show fewer' : `Show all ${filtered.length} deployments`}
          </MuiLink>
        </Typography>
      )}
    </Section>
  );
}

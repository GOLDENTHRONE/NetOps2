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
 * The Cleanup page: an uninstall in Flux often leaves a namespace full of
 * orphaned objects behind (a HelmRelease's PVCs, a Kustomization's pruned-but-
 * stuck workloads). This page surfaces the namespaces a recent Flux uninstall
 * touched and lets an operator sweep the chosen kinds of leftover objects,
 * with a live, honest view of exactly what is being deleted.
 */

import { Icon } from '@iconify/react';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { DateLabel, Loader } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  alpha,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import React from 'react';
import {
  CLEANUP_KINDS,
  CleanupItem,
  findRecentUninstalls,
  RecentUninstall,
  summarizeCleanup,
} from '../flux/cleanup';
import { ICONS, kindIcon } from '../flux/icon';
import { FluxObject } from '../flux/utils';
import { EmptyState, PageHeader, Pill, RADII, Section, Surface, useAccents } from './ui';

const { ResourceClasses } = K8s;

/** Cluster-wide events, turned into "recent Flux uninstall" suggestions. */
function useRecentUninstalls(): { suggestions: RecentUninstall[]; loading: boolean; error: any } {
  const [events, error] = (ResourceClasses as Record<string, any>).Event.useList();
  const suggestions = React.useMemo(() => {
    if (!events) {
      return [];
    }
    return findRecentUninstalls(events.map((e: any) => e.jsonData as FluxObject));
  }, [events]);
  return { suggestions, loading: events === null && !error, error };
}

/** One suggested namespace card (a recent Flux uninstall). */
function SuggestionCard(props: { suggestion: RecentUninstall; onClean: (ns: string) => void }) {
  const { suggestion, onClean } = props;
  const accents = useAccents();
  return (
    <Surface
      interactive
      accent={accents.warning}
      onClick={() => onClean(suggestion.namespace)}
      sx={{ p: 2, minWidth: 260, flex: '1 1 300px', maxWidth: 440 }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Icon icon={ICONS.namespace} width="1.1rem" color={accents.warning} />
        <Typography variant="subtitle1" sx={{ fontWeight: 700, minWidth: 0 }} noWrap>
          {suggestion.namespace}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 1 }}>
        <Pill tone="warning" icon={ICONS.delete}>
          {suggestion.reason || 'Uninstalled'}
        </Pill>
        <Pill tone="neutral" icon={ICONS.flux}>
          {suggestion.controller}
        </Pill>
      </Box>
      <Typography
        variant="caption"
        color="text.secondary"
        component="div"
        sx={{ mt: 1, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
      >
        {suggestion.message}
      </Typography>
      {suggestion.time && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
          <DateLabel date={suggestion.time} format="mini" /> ago
        </Typography>
      )}
    </Surface>
  );
}

/**
 * Lists every cleanup kind in the namespace so the modal can show live counts
 * next to each checkbox. The kind list is constant, so calling the list hook
 * in a loop keeps a stable hook order.
 */
function useNamespaceInventory(namespace: string) {
  const results = CLEANUP_KINDS.map(def => {
    const cls = (ResourceClasses as Record<string, any>)[def.kind];
    const [items, error] = cls
      ? cls.useList({ namespace })
      : [[], new Error(`Unknown kind ${def.kind}`)];
    return { def, items: (items ?? []) as any[], error, loading: items === null && !error };
  });
  const loading = results.some(r => r.loading);
  return { results, loading };
}

type Phase = 'select' | 'running' | 'done';

/** The cleanup modal: pick kinds, confirm, then watch the sweep happen. */
function CleanupModal(props: { namespace: string; onClose: () => void }) {
  const { namespace, onClose } = props;
  const theme = useTheme();
  const accents = useAccents();
  const { results, loading } = useNamespaceInventory(namespace);

  const [selected, setSelected] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries(CLEANUP_KINDS.map(k => [k.kind, k.defaultSelected]))
  );
  const [force, setForce] = React.useState(false);
  const [phase, setPhase] = React.useState<Phase>('select');
  const [items, setItems] = React.useState<CleanupItem[]>([]);
  const logEndRef = React.useRef<HTMLDivElement | null>(null);

  const countByKind = React.useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of results) {
      map[r.def.kind] = r.items.length;
    }
    return map;
  }, [results]);

  const selectedTotal = React.useMemo(
    () =>
      CLEANUP_KINDS.reduce(
        (sum, k) => sum + (selected[k.kind] ? countByKind[k.kind] ?? 0 : 0),
        0
      ),
    [selected, countByKind]
  );

  React.useEffect(() => {
    if (phase === 'running') {
      logEndRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [items, phase]);

  const running = phase === 'running';
  const processed = items.filter(i => i.status === 'deleted' || i.status === 'failed').length;

  const runCleanup = async () => {
    // Snapshot the live KubeObject instances now: the lists keep updating as
    // objects disappear, but we delete exactly what was on screen at click.
    const queue: { obj: any; item: CleanupItem }[] = [];
    for (const r of results) {
      if (!selected[r.def.kind]) {
        continue;
      }
      for (const obj of r.items) {
        queue.push({
          obj,
          item: {
            kind: r.def.kind,
            name: obj.metadata?.name ?? '',
            namespace: obj.metadata?.namespace ?? namespace,
            status: 'pending',
            force,
          },
        });
      }
    }
    if (queue.length === 0) {
      return;
    }
    setItems(queue.map(q => q.item));
    setPhase('running');

    for (let i = 0; i < queue.length; i++) {
      setItems(prev => prev.map((it, idx) => (idx === i ? { ...it, status: 'deleting' } : it)));
      try {
        await queue[i].obj.delete(force);
        setItems(prev => prev.map((it, idx) => (idx === i ? { ...it, status: 'deleted' } : it)));
      } catch (err: any) {
        setItems(prev =>
          prev.map((it, idx) =>
            idx === i ? { ...it, status: 'failed', error: String(err?.message ?? err) } : it
          )
        );
      }
    }
    setPhase('done');
  };

  const statusColor = (status: CleanupItem['status']) =>
    status === 'deleted'
      ? accents.success
      : status === 'failed'
      ? accents.error
      : status === 'deleting'
      ? accents.info
      : theme.palette.text.secondary;

  return (
    <Dialog
      open
      maxWidth="md"
      fullWidth
      // While the sweep runs the modal is locked: no backdrop, Escape or close
      // button can dismiss it, so a delete is never left half-done.
      onClose={(_e, reason) => {
        if (running || reason === 'backdropClick' || reason === 'escapeKeyDown') {
          return;
        }
        onClose();
      }}
      disableEscapeKeyDown={running}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Icon icon={ICONS.delete} color={accents.error} width="1.4rem" />
        <Box sx={{ minWidth: 0 }}>
          <Typography component="div" variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
            Clean up leftovers
          </Typography>
          <Typography component="div" variant="caption" color="text.secondary">
            Namespace <b>{namespace}</b>
          </Typography>
        </Box>
      </DialogTitle>

      <DialogContent dividers>
        {phase === 'select' && (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              Select the kinds of objects to delete from <b>{namespace}</b>. Counts are live from
              the cluster. Off-by-default kinds can carry data or permissions a future install may
              reuse.
            </Typography>
            {loading && (
              <Box sx={{ mb: 1 }}>
                <Loader title="Scanning namespace" size={18} />
              </Box>
            )}
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                gap: 0.5,
              }}
            >
              {CLEANUP_KINDS.map(def => {
                const count = countByKind[def.kind] ?? 0;
                const disabled = count === 0;
                return (
                  <Tooltip key={def.kind} title={def.note ?? ''} placement="top-start">
                    <FormControlLabel
                      sx={{
                        m: 0,
                        borderRadius: RADII.control,
                        px: 1,
                        opacity: disabled ? 0.5 : 1,
                        '&:hover': { backgroundColor: alpha(accents.primary, 0.06) },
                      }}
                      control={
                        <Checkbox
                          size="small"
                          checked={!!selected[def.kind] && !disabled}
                          disabled={disabled}
                          onChange={e =>
                            setSelected(s => ({ ...s, [def.kind]: e.target.checked }))
                          }
                        />
                      }
                      label={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                          <Icon icon={kindIcon(def.kind)} width="1rem" />
                          <span>{def.label}</span>
                          <Box
                            component="span"
                            sx={{
                              px: 0.6,
                              borderRadius: RADII.pill,
                              fontSize: '0.7rem',
                              fontWeight: 700,
                              color: count > 0 ? accents.primary : theme.palette.text.disabled,
                              backgroundColor: alpha(
                                count > 0 ? accents.primary : theme.palette.text.disabled,
                                0.12
                              ),
                            }}
                          >
                            {count}
                          </Box>
                        </Box>
                      }
                    />
                  </Tooltip>
                );
              })}
            </Box>
            <Box
              sx={{
                mt: 1.5,
                pt: 1.5,
                borderTop: `1px solid ${theme.palette.divider}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 1,
              }}
            >
              <Tooltip title="Delete with grace period 0 (--force). Use for objects stuck terminating.">
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={force}
                      onChange={e => setForce(e.target.checked)}
                      sx={{ color: accents.error, '&.Mui-checked': { color: accents.error } }}
                    />
                  }
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Icon icon={ICONS.force} width="1rem" color={accents.error} />
                      <span>Force delete (grace period 0)</span>
                    </Box>
                  }
                />
              </Tooltip>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {selectedTotal} object{selectedTotal === 1 ? '' : 's'} selected
              </Typography>
            </Box>
          </>
        )}

        {(phase === 'running' || phase === 'done') && (
          <>
            {phase === 'done' ? (
              <CleanupSummary items={items} namespace={namespace} />
            ) : (
              <Box sx={{ mb: 1.5 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                  Deleting {processed}/{items.length} objects{force ? ' with force=true' : ''}…
                </Typography>
                <Box
                  sx={{
                    height: 6,
                    borderRadius: RADII.pill,
                    backgroundColor: alpha(accents.info, 0.15),
                    overflow: 'hidden',
                  }}
                >
                  <Box
                    sx={{
                      height: '100%',
                      width: `${items.length ? (processed / items.length) * 100 : 0}%`,
                      backgroundColor: accents.info,
                      borderRadius: RADII.pill,
                      transition: 'width 0.25s ease',
                    }}
                  />
                </Box>
              </Box>
            )}
            <Surface sx={{ p: 1, maxHeight: 320, overflow: 'auto' }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                {items.map((item, idx) => (
                  <Box
                    key={`${item.kind}/${item.name}/${idx}`}
                    sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 0.5, py: 0.25 }}
                  >
                    <Icon
                      icon={
                        item.status === 'deleted'
                          ? ICONS.statusReady
                          : item.status === 'failed'
                          ? ICONS.statusError
                          : item.status === 'deleting'
                          ? ICONS.statusReconciling
                          : ICONS.clock
                      }
                      width="1rem"
                      color={statusColor(item.status)}
                      className={item.status === 'deleting' ? 'flux-spin' : undefined}
                    />
                    <Icon icon={kindIcon(item.kind)} width="0.95rem" style={{ opacity: 0.7 }} />
                    <Typography variant="caption" sx={{ fontWeight: 600 }}>
                      {item.kind}
                    </Typography>
                    <Typography variant="caption" sx={{ minWidth: 0 }} noWrap>
                      {item.name}
                    </Typography>
                    {item.force && (
                      <Box
                        component="span"
                        sx={{
                          px: 0.5,
                          borderRadius: RADII.pill,
                          fontSize: '0.62rem',
                          fontWeight: 700,
                          color: accents.error,
                          backgroundColor: alpha(accents.error, 0.13),
                        }}
                      >
                        force
                      </Box>
                    )}
                    <Box sx={{ flex: 1 }} />
                    <Typography
                      variant="caption"
                      sx={{ color: statusColor(item.status), fontWeight: 600 }}
                    >
                      {item.status}
                      {item.error ? `: ${item.error}` : ''}
                    </Typography>
                  </Box>
                ))}
                <div ref={logEndRef} />
              </Box>
            </Surface>
          </>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        {phase === 'select' && (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="contained"
              disabled={selectedTotal === 0}
              onClick={runCleanup}
              startIcon={<Icon icon={ICONS.delete} />}
              sx={{
                backgroundColor: accents.error,
                '&:hover': { backgroundColor: alpha(accents.error, 0.85) },
              }}
            >
              Clean up {selectedTotal} object{selectedTotal === 1 ? '' : 's'}
            </Button>
          </>
        )}
        {phase === 'running' && (
          <Button disabled startIcon={<Icon icon={ICONS.statusReconciling} className="flux-spin" />}>
            Cleaning up…
          </Button>
        )}
        {phase === 'done' && (
          <Button variant="contained" onClick={onClose}>
            Done
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

/** The completion view: what actually got cleaned, by kind. */
function CleanupSummary(props: { items: CleanupItem[]; namespace: string }) {
  const { items, namespace } = props;
  const accents = useAccents();
  const { byKind, totalDeleted, totalFailed } = summarizeCleanup(items);
  return (
    <Box sx={{ mb: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Icon
          icon={totalFailed > 0 ? ICONS.warning : ICONS.statusReady}
          width="1.5rem"
          color={totalFailed > 0 ? accents.warning : accents.success}
        />
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          Cleaned up {totalDeleted} object{totalDeleted === 1 ? '' : 's'} from {namespace}
          {totalFailed > 0 ? ` · ${totalFailed} failed` : ''}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
        {byKind.map(k => (
          <Pill
            key={k.kind}
            tone={k.failed > 0 ? 'warning' : 'success'}
            icon={kindIcon(k.kind)}
          >
            {k.kind}: {k.deleted}
            {k.failed > 0 ? ` (${k.failed} failed)` : ''}
          </Pill>
        ))}
        {byKind.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Nothing was deleted.
          </Typography>
        )}
      </Box>
    </Box>
  );
}

/** Suggested namespaces (recent Flux uninstalls) plus a free namespace picker. */
function CleanupChooser(props: { onClean: (ns: string) => void }) {
  const { onClean } = props;
  const { suggestions, loading, error } = useRecentUninstalls();
  const [namespaces] = (ResourceClasses as Record<string, any>).Namespace.useList();
  const [picked, setPicked] = React.useState<string | null>(null);

  const nsNames: string[] = React.useMemo(
    () =>
      (namespaces ?? [])
        .map((n: any) => n.metadata?.name)
        .filter(Boolean)
        .sort((a: string, b: string) => a.localeCompare(b)),
    [namespaces]
  );

  // Only suggest namespaces that still exist (a fully-drained one is nothing
  // to clean). When the namespace list has not loaded yet, show all.
  const liveSuggestions = React.useMemo(
    () =>
      namespaces
        ? suggestions.filter(s => nsNames.includes(s.namespace))
        : suggestions,
    [suggestions, nsNames, namespaces]
  );

  return (
    <>
      <Section
        title="Recent Flux uninstalls"
        icon={ICONS.delete}
        description="Namespaces a Flux controller removed objects from in the last few hours. These are the most likely to hold leftovers."
      >
        {loading ? (
          <Surface sx={{ p: 2 }}>
            <Loader title="Looking for recent uninstalls" />
          </Surface>
        ) : error ? (
          <Surface sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Could not read cluster events to detect recent uninstalls. You can still pick a
              namespace below.
            </Typography>
          </Surface>
        ) : liveSuggestions.length === 0 ? (
          <Surface sx={{ p: 0 }}>
            <EmptyState
              icon={ICONS.statusReady}
              title="No recent uninstalls detected"
              description="Nothing has been uninstalled by Flux recently. Pick any namespace below to clean it up manually."
            />
          </Surface>
        ) : (
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            {liveSuggestions.map(s => (
              <SuggestionCard key={s.namespace} suggestion={s} onClean={onClean} />
            ))}
          </Box>
        )}
      </Section>

      <Section
        title="Clean up any namespace"
        icon={ICONS.namespace}
        description="Choose a namespace to inspect and sweep leftover objects from."
      >
        <Surface sx={{ p: 2, display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
          <Autocomplete
            size="small"
            options={nsNames}
            value={picked}
            onChange={(_e, v) => setPicked(v)}
            sx={{ minWidth: 280 }}
            renderInput={params => (
              <TextField {...params} placeholder="Select a namespace" label="Namespace" />
            )}
          />
          <Button
            variant="contained"
            disabled={!picked}
            startIcon={<Icon icon={ICONS.delete} />}
            onClick={() => picked && onClean(picked)}
          >
            Inspect &amp; clean
          </Button>
        </Surface>
      </Section>
    </>
  );
}

export default function CleanupPage() {
  const [target, setTarget] = React.useState<string | null>(null);
  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 1600, mx: 'auto' }}>
      <style>{'@keyframes flux-spin{to{transform:rotate(360deg)}}.flux-spin{animation:flux-spin 1s linear infinite}'}</style>
      <PageHeader
        icon={ICONS.delete}
        title="Cleanup"
        description="Find and remove the objects a Flux uninstall left behind, safely and transparently."
        crumbs={[{ label: 'Flux', route: 'fluxOverview' }, { label: 'Cleanup' }]}
      />
      <CleanupChooser onClean={setTarget} />
      {target && <CleanupModal namespace={target} onClose={() => setTarget(null)} />}
    </Box>
  );
}

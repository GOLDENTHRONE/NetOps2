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
 * The Flux plugin's small design system. A cohesive, modern, Ant-Design-inspired
 * layer built on top of MUI: soft rounded surfaces, a restrained accent palette,
 * clear typographic hierarchy and breadcrumb-based page context. Every Flux page
 * is composed from these primitives so the whole UI reads as one product.
 *
 * All colors are derived from the active MUI theme (via alpha tints), so light
 * and dark modes both look right and nothing is hard-coded to a single mode.
 */

import { Icon } from '@iconify/react';
import { K8s, Router } from '@kinvolk/headlamp-plugin/lib';
import {
  alpha,
  Autocomplete,
  Box,
  Breadcrumbs,
  Chip,
  Link as MuiLink,
  TextField,
  Theme,
  Typography,
  useTheme,
} from '@mui/material';
import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link as RouterLink } from 'react-router-dom';
import { ICONS } from '../flux/icon';

const { createRouteURL } = Router;

/**
 * A single, wide namespace filter for a whole page. It reads and writes the
 * same global namespace filter the rest of Headlamp uses, so one selection at
 * the top of the page scopes every list and the dependency graph below — no
 * need to pick a namespace per section. Full namespace names stay visible as
 * chips (unlike the truncated built-in filter).
 */
export function NamespaceBar() {
  const theme = useTheme();
  const dispatch = useDispatch();
  const selected = useSelector((state: any) => state.filter?.namespaces as Set<string> | undefined);
  const [namespaces] = (K8s.ResourceClasses as any).Namespace.useList();
  const options: string[] = React.useMemo(
    () =>
      (namespaces ?? [])
        .map((n: any) => n.metadata?.name)
        .filter(Boolean)
        .sort((a: string, b: string) => a.localeCompare(b)),
    [namespaces]
  );
  const value = React.useMemo(() => Array.from(selected ?? []), [selected]);

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2.5, flexWrap: 'wrap' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: 'text.secondary' }}>
        <Icon icon={ICONS.namespace} width="1.1rem" />
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          Namespace
        </Typography>
      </Box>
      <Autocomplete
        multiple
        size="small"
        options={options}
        value={value}
        onChange={(_e, newValue) =>
          dispatch({ type: 'filter/setNamespaceFilter', payload: newValue })
        }
        disableCloseOnSelect
        limitTags={6}
        sx={{ minWidth: 340, maxWidth: 720, flex: '1 1 340px' }}
        renderTags={(tags, getTagProps) =>
          tags.map((tag, index) => (
            <Chip
              size="small"
              label={tag}
              {...getTagProps({ index })}
              key={tag}
              sx={{
                borderRadius: RADII.control,
                backgroundColor: alpha(accentsFor(theme).primary, 0.12),
                color: accentsFor(theme).primary,
                fontWeight: 600,
              }}
            />
          ))
        }
        renderInput={params => (
          <TextField
            {...params}
            variant="outlined"
            placeholder={value.length === 0 ? 'All namespaces' : ''}
          />
        )}
      />
    </Box>
  );
}

/**
 * A searchable, single-pick namespace selector for pages that need a
 * namespace before they can render (graphs, waves). Picking one sets the
 * same global namespace context the rest of the Flux pages use, so the
 * choice follows the user across pages until they change it.
 */
export function NamespacePicker(props: { placeholder?: string }) {
  const dispatch = useDispatch();
  const [namespaces] = (K8s.ResourceClasses as any).Namespace.useList();
  const options: string[] = React.useMemo(
    () =>
      (namespaces ?? [])
        .map((n: any) => n.metadata?.name)
        .filter(Boolean)
        .sort((a: string, b: string) => a.localeCompare(b)),
    [namespaces]
  );
  return (
    <Autocomplete
      size="small"
      options={options}
      value={null}
      onChange={(_e, newValue) =>
        dispatch({ type: 'filter/setNamespaceFilter', payload: newValue ? [newValue] : [] })
      }
      sx={{ minWidth: 280, maxWidth: 360 }}
      renderInput={params => (
        <TextField
          {...params}
          variant="outlined"
          placeholder={props.placeholder ?? 'Search namespaces…'}
        />
      )}
    />
  );
}

/** Shared radii — soft, modern corners. */
export const RADII = {
  card: '14px',
  control: '10px',
  pill: '999px',
};

/**
 * A vibrant-but-tasteful accent palette (Tailwind-ish hues), independent of
 * Headlamp's muted default theme so the Flux UI reads fresh and modern. Tuned
 * per light/dark mode for good contrast on either background.
 */
export type Accents = {
  primary: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  neutral: string;
  muted: string;
};

const LIGHT_ACCENTS: Accents = {
  primary: '#6366f1', // indigo-500
  success: '#10b981', // emerald-500
  warning: '#f59e0b', // amber-500
  error: '#ef4444', // red-500
  info: '#3b82f6', // blue-500
  neutral: '#64748b', // slate-500
  muted: '#94a3b8', // slate-400
};

const DARK_ACCENTS: Accents = {
  primary: '#a5b4fc', // indigo-300
  success: '#34d399', // emerald-400
  warning: '#fbbf24', // amber-400
  error: '#f87171', // red-400
  info: '#60a5fa', // blue-400
  neutral: '#94a3b8', // slate-400
  muted: '#64748b', // slate-500
};

export function accentsFor(theme: Theme): Accents {
  return theme.palette.mode === 'dark' ? DARK_ACCENTS : LIGHT_ACCENTS;
}

/** Hook form of {@link accentsFor}. */
export function useAccents(): Accents {
  return accentsFor(useTheme());
}

/** A whisper-soft border used only where a card genuinely needs separation. */
export function surfaceBorder(theme: Theme) {
  return `1px solid ${alpha(theme.palette.divider, theme.palette.mode === 'dark' ? 0.5 : 0.6)}`;
}

export interface SurfaceProps {
  children: React.ReactNode;
  /** Left accent bar color, e.g. a status color. */
  accent?: string;
  /** Tinted background using the accent color. */
  tinted?: boolean;
  interactive?: boolean;
  onClick?: (e: React.MouseEvent<HTMLElement>) => void;
  sx?: any;
}

/** A soft, elevated card — the base building block of the UI. */
export function Surface(props: SurfaceProps) {
  const { children, accent, tinted, interactive, onClick, sx } = props;
  const theme = useTheme();
  const dark = theme.palette.mode === 'dark';
  return (
    <Box
      onClick={onClick}
      sx={{
        borderRadius: RADII.card,
        // Rely on a soft shadow rather than a hard outline; only a hairline
        // border in dark mode where shadows are invisible.
        border: dark ? surfaceBorder(theme) : 'none',
        backgroundColor:
          tinted && accent ? alpha(accent, dark ? 0.14 : 0.08) : theme.palette.background.paper,
        borderLeft: accent ? `3px solid ${accent}` : undefined,
        boxShadow: dark
          ? 'none'
          : '0 1px 3px rgba(16, 24, 40, 0.06), 0 1px 2px rgba(16, 24, 40, 0.04)',
        transition: 'box-shadow 0.18s ease, transform 0.18s ease',
        ...(interactive
          ? {
              cursor: 'pointer',
              '&:hover': {
                boxShadow: dark
                  ? `0 0 0 1px ${alpha(accent ?? theme.palette.primary.main, 0.5)}`
                  : '0 8px 24px rgba(16, 24, 40, 0.12)',
                transform: 'translateY(-2px)',
              },
            }
          : {}),
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}

export type PillTone = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'primary';

/** Resolves a tone to its vibrant accent color. */
export function toneColor(theme: Theme, tone: PillTone): string {
  const a = accentsFor(theme);
  return a[tone] ?? a.neutral;
}

/** A compact, modern status tag: tinted background, vibrant text, soft dot. */
export function Pill(props: {
  tone: PillTone;
  icon?: string;
  children: React.ReactNode;
  title?: string;
}) {
  const { tone, icon, children, title } = props;
  const theme = useTheme();
  const color = toneColor(theme, tone);
  return (
    <Box
      component="span"
      title={title}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        px: 1,
        py: '3px',
        borderRadius: RADII.pill,
        fontSize: '0.75rem',
        fontWeight: 600,
        lineHeight: 1.5,
        color,
        backgroundColor: alpha(color, theme.palette.mode === 'dark' ? 0.2 : 0.13),
        whiteSpace: 'nowrap',
      }}
    >
      {icon ? (
        <Icon icon={icon} width="0.9rem" height="0.9rem" />
      ) : (
        <Box
          component="span"
          sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: color }}
        />
      )}
      {children}
    </Box>
  );
}

export interface Crumb {
  label: string;
  /** Route name to link to. Omit for the current (last) crumb. */
  route?: string;
}

/**
 * The page header that gives every page its context: a breadcrumb trail
 * (Flux › Sources › …), an icon, a title and a short description — so users
 * always know where they are and what they are looking at.
 */
export function PageHeader(props: {
  icon?: string;
  title: string;
  description?: string;
  crumbs?: Crumb[];
  actions?: React.ReactNode;
}) {
  const { icon, title, description, crumbs, actions } = props;
  const theme = useTheme();
  return (
    <Box sx={{ mb: 2.5 }}>
      {crumbs && crumbs.length > 0 && (
        <Breadcrumbs
          separator={<Icon icon={ICONS.chevronRight} width="0.9rem" />}
          sx={{ mb: 1, fontSize: '0.8rem' }}
        >
          {crumbs.map((c, i) => {
            const url = c.route ? safeRoute(c.route) : undefined;
            if (url && i < crumbs.length - 1) {
              return (
                <MuiLink
                  key={c.label}
                  component={RouterLink}
                  to={url}
                  underline="hover"
                  color="text.secondary"
                  sx={{ fontSize: '0.8rem' }}
                >
                  {c.label}
                </MuiLink>
              );
            }
            return (
              <Typography
                key={c.label}
                color="text.primary"
                sx={{ fontSize: '0.8rem', fontWeight: 600 }}
              >
                {c.label}
              </Typography>
            );
          })}
        </Breadcrumbs>
      )}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
        {icon && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 40,
              height: 40,
              borderRadius: RADII.control,
              flexShrink: 0,
              color: theme.palette.primary.main,
              backgroundColor: alpha(theme.palette.primary.main, 0.1),
            }}
          >
            <Icon icon={icon} width="1.4rem" />
          </Box>
        )}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
            {title}
          </Typography>
          {description && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              {description}
            </Typography>
          )}
        </Box>
        {actions && <Box sx={{ flexShrink: 0 }}>{actions}</Box>}
      </Box>
    </Box>
  );
}

/** A titled section with an optional icon and side actions. */
export function Section(props: {
  title?: React.ReactNode;
  icon?: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  sx?: any;
}) {
  const { title, icon, description, actions, children, sx } = props;
  return (
    <Box sx={{ mb: 3, ...sx }}>
      {(title || actions) && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
            mb: 1.25,
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              {icon && <Icon icon={icon} width="1.15rem" />}
              {typeof title === 'string' ? (
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  {title}
                </Typography>
              ) : (
                title
              )}
            </Box>
            {description && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                {description}
              </Typography>
            )}
          </Box>
          {actions && <Box sx={{ flexShrink: 0 }}>{actions}</Box>}
        </Box>
      )}
      {children}
    </Box>
  );
}

/** A friendly, illustrated empty state — never a blank page. */
export function EmptyState(props: {
  icon?: string;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  const { icon = ICONS.info, title, description, action } = props;
  const theme = useTheme();
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 1,
        py: 5,
        px: 2,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 56,
          height: 56,
          borderRadius: '50%',
          color: theme.palette.text.secondary,
          backgroundColor: alpha(theme.palette.text.primary, 0.05),
          mb: 0.5,
        }}
      >
        <Icon icon={icon} width="1.8rem" />
      </Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
        {title}
      </Typography>
      {description && (
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 460 }}>
          {description}
        </Typography>
      )}
      {action && <Box sx={{ mt: 1 }}>{action}</Box>}
    </Box>
  );
}

/** A definition row (label + value) with consistent alignment. */
export function InfoRow(props: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', gap: 2, py: 0.75, alignItems: 'baseline' }}>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 160, flexShrink: 0 }}>
        {props.label}
      </Typography>
      <Box sx={{ minWidth: 0, fontSize: '0.875rem' }}>{props.children}</Box>
    </Box>
  );
}

function safeRoute(name: string): string | undefined {
  try {
    const url = createRouteURL(name);
    return url || undefined;
  } catch (e) {
    return undefined;
  }
}

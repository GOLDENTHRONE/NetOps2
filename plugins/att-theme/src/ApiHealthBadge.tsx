import { Icon } from '@iconify/react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Popover from '@mui/material/Popover';
import { useTheme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import React, { useState } from 'react';

export type ApiHealthStatus = 'healthy' | 'degraded' | 'down' | 'unknown' | 'checking';

export interface ApiHealthMetaItem {
  label: string;
  value: string;
}

export interface ApiHealth {
  status: ApiHealthStatus;
  label: string;
  lastCheckedAt: string | null;
  meta: ApiHealthMetaItem[];
}

const apiHealth: ApiHealth = {
  status: 'unknown',
  label: 'Under construction',
  lastCheckedAt: null,
  meta: [],
};

const lightTokens = {
  '--api-pill-bg': '#F2F4F7',
  '--api-pill-text': '#344054',
  '--api-pill-border': '#EAECF0',
  '--api-popover-bg': '#FFFFFF',
  '--api-popover-border': '#E5E7EB',
  '--api-popover-shadow': '0 14px 34px rgba(15, 23, 42, 0.16)',
  '--api-text': '#1F2937',
  '--api-muted-text': '#8A94A6',
  '--api-meta-bg': '#F3F4F6',
  '--api-meta-label': '#9AA3B2',
  '--api-meta-value': '#344054',
  '--status-unknown': '#8C96A6',
} as React.CSSProperties;

const darkTokens = {
  '--api-pill-bg': '#1F2933',
  '--api-pill-text': '#D7DEE8',
  '--api-pill-border': '#2E3742',
  '--api-popover-bg': '#121820',
  '--api-popover-border': '#2E3742',
  '--api-popover-shadow': '0 18px 42px rgba(0, 0, 0, 0.42)',
  '--api-text': '#E5E7EB',
  '--api-muted-text': '#9AA3B2',
  '--api-meta-bg': '#202833',
  '--api-meta-label': '#8C96A6',
  '--api-meta-value': '#D7DEE8',
  '--status-unknown': '#8C96A6',
} as React.CSSProperties;

export function ApiStatusIndicator() {
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
  const theme = useTheme();
  const tokens = theme.palette.mode === 'dark' ? darkTokens : lightTokens;
  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => setAnchorEl(event.currentTarget);
  const handleClose = () => setAnchorEl(null);
  const open = Boolean(anchorEl);

  return (
    <>
      <Box
        component="button"
        type="button"
        onClick={handleClick}
        aria-label={`API status: ${apiHealth.label}`}
        style={tokens}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          mx: 1.5,
          px: 1.5,
          py: 0.5,
          borderRadius: '16px',
          border: '1px solid var(--api-pill-border, transparent)',
          backgroundColor: 'var(--api-pill-bg)',
          color: 'var(--api-pill-text)',
          cursor: 'pointer',
          '&:hover': {
            filter: 'brightness(0.96)',
          },
        }}
      >
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: 'var(--status-unknown)',
          }}
        />
        <Typography variant="caption" fontWeight={600}>
          API
        </Typography>
      </Box>

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        PaperProps={{
          style: tokens,
          sx: {
            p: 2,
            width: 360,
            borderRadius: '12px',
            backgroundColor: 'var(--api-popover-bg)',
            borderColor: 'var(--api-popover-border)',
            boxShadow: 'var(--api-popover-shadow)',
          },
        }}
      >
        <Box display="flex" flexDirection="column" gap={1.5}>
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Box display="flex" alignItems="center" gap={1}>
              <Icon
                icon="mdi:progress-wrench"
                color="var(--status-unknown)"
                width={22}
              />
              <Typography variant="subtitle1" fontWeight={700}>
                {apiHealth.label}
              </Typography>
            </Box>
            <Tooltip title="API health is not configured">
              <span>
                <IconButton disabled aria-label="Refresh API health" size="small">
                  <Icon icon="mdi:refresh" width={20} />
                </IconButton>
              </span>
            </Tooltip>
          </Box>

          <Typography variant="caption" sx={{ color: 'var(--api-muted-text)' }}>
            Health checks are under construction.
          </Typography>
        </Box>
      </Popover>
    </>
  );
}
